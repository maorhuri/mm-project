import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load `.env` for non-Next processes (worker, seed, tests). Next.js loads its
 * own env files. Walks up from cwd so it works from any workspace directory.
 * Existing process env always wins (never overrides).
 */
function loadEnvFile(): void {
  if (process.env.MM_ENV_LOADED === '1') return;
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  process.env.MM_ENV_LOADED = '1';
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const notPlaceholder = (v: string) => !/^change-me/i.test(v);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('MM Marketing OS'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 chars'),
    APP_ENCRYPTION_KEY: z.string().min(32, 'APP_ENCRYPTION_KEY must be base64 of 32 bytes'),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    TZ: z.string().default('Asia/Jerusalem'),
    DEFAULT_LOCALE: z.string().default('he-IL'),
    DEFAULT_CURRENCY: z.string().default('ILS'),

    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

    STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
    S3_ENDPOINT: z.string().url().default('http://127.0.0.1:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('mm-media'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: bool(true),
    MEDIA_PUBLIC_BASE_URL: z.string().optional(),
    MEDIA_MAX_UPLOAD_MB: z.coerce.number().positive().default(200),

    AI_MONTHLY_BUDGET_ILS: z.coerce.number().nonnegative().default(500),
    AI_SINGLE_RUN_MAX_ILS: z.coerce.number().nonnegative().default(25),
    META_ADS_WRITE_ENABLED: bool(false),
    GOOGLE_ADS_WRITE_ENABLED: bool(false),

    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['APP_SECRET', 'APP_ENCRYPTION_KEY', 'S3_SECRET_KEY'] as const) {
        if (!notPlaceholder(env[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} still has a placeholder value in production`,
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

/** Validated configuration. Throws a readable error listing problems on first use. */
export function getConfig(): AppConfig {
  if (cached) return cached;
  loadEnvFile();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: force re-parse after mutating process.env. */
export function resetConfigCache(): void {
  cached = undefined;
}

export const isProduction = () => getConfig().NODE_ENV === 'production';
