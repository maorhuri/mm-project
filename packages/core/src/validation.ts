import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, digits and dashes');

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');

export const emailSchema = z.string().trim().toLowerCase().email();
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export const brandCreateSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  slug: slugSchema.optional(),
  industry: z.string().trim().max(80).optional().or(z.literal('')),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  websiteUrl: z.string().trim().url().optional().or(z.literal('')),
  isDemo: z.boolean().optional(),
});

export const brandUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  websiteUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(64).optional(),
  currency: z.string().length(3).optional(),
  isDemo: z.boolean().optional(),
});

export const brandColorsSchema = z.object({
  primary: hexColorSchema.optional(),
  secondary: hexColorSchema.optional(),
  accent: hexColorSchema.optional(),
  background: hexColorSchema.optional(),
  foreground: hexColorSchema.optional(),
});

export const brandFontsSchema = z.object({
  heading: z.string().trim().max(80).optional(),
  body: z.string().trim().max(80).optional(),
});

export const brandToneSchema = z.object({
  voice: z.string().trim().max(500).optional(),
  style: z.string().trim().max(500).optional(),
  language: z.string().trim().max(40).optional(),
  doNots: z.array(z.string().trim().max(200)).max(50).optional(),
});

export const audienceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
  painPoints: z.array(z.string().trim().max(200)).max(20).optional(),
});

const stringList = z.array(z.string().trim().min(1).max(120)).max(100);

export const brandSettingsSchema = z.object({
  colors: brandColorsSchema.optional(),
  fonts: brandFontsSchema.optional(),
  tone: brandToneSchema.optional(),
  audiences: z.array(audienceSchema).max(30).optional(),
  keywords: stringList.optional(),
  hashtags: stringList.optional(),
  ctaPresets: stringList.optional(),
  allowedClaims: stringList.optional(),
  forbiddenClaims: stringList.optional(),
  graphicStyle: z.string().trim().max(1000).nullable().optional(),
  publishingMode: z.enum(['MANUAL', 'SEMI_AUTO', 'AUTO']).optional(),
  contentTargets: z.record(z.string(), z.number().int().min(0).max(500)).optional(),
  monthlyAdBudgetIls: z.number().nonnegative().max(10_000_000).nullable().optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  category: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  audiences: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  priceFromIls: z.number().nonnegative().max(100_000_000).nullable().optional(),
  pricingNote: z.string().trim().max(500).nullable().optional(),
  url: z.string().trim().url().nullable().optional().or(z.literal('')),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const knowledgeSchema = z.object({
  kind: z.enum([
    'WEBSITE',
    'SERVICE_PAGE',
    'PRICING',
    'FAQ',
    'DOCUMENT',
    'MANUAL',
    'CREATIVE',
    'CAMPAIGN_DATA',
  ]),
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  content: z.string().trim().min(1).max(100_000),
});

export const competitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const brandAssetSchema = z.object({
  type: z.enum(['LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON', 'FONT', 'BRAND_IMAGE']),
  mediaAssetId: z.string().uuid(),
  label: z.string().trim().max(80).nullable().optional(),
});

export const websiteAnalyzeSchema = z.object({
  url: z.string().trim().url().max(2000).optional(),
});

export const brandImportApplySchema = z.object({
  colors: brandColorsSchema.optional(),
  fonts: brandFontsSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  logo: z
    .object({
      url: z.string().trim().url().max(2000),
      type: z.enum(['LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON']),
    })
    .optional(),
  sourceUrl: z.string().trim().url().max(2000).optional(),
});

export const mediaUpdateSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  altText: z.string().trim().max(500).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
});

export const mediaListQuerySchema = z.object({
  kind: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'FONT', 'DOCUMENT', 'OTHER']).optional(),
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  note: z.string().trim().max(2000).optional(),
});

export const approvalListQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SCHEDULED', 'EXECUTED', 'FAILED'])
    .optional(),
  type: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;
export type BrandSettingsInput = z.infer<typeof brandSettingsSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type KnowledgeInput = z.infer<typeof knowledgeSchema>;
export type CompetitorInput = z.infer<typeof competitorSchema>;
export type BrandAssetInput = z.infer<typeof brandAssetSchema>;
export type WebsiteAnalyzeInput = z.infer<typeof websiteAnalyzeSchema>;
export type BrandImportApplyInput = z.infer<typeof brandImportApplySchema>;
export type MediaUpdateInput = z.infer<typeof mediaUpdateSchema>;
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;
export type ApprovalListQuery = z.infer<typeof approvalListQuerySchema>;

/** Derive a URL-safe slug from a (possibly Hebrew) name; falls back to a short random id. */
export function slugify(input: string, fallbackPrefix = 'item'): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 2) return ascii.slice(0, 64);
  return `${fallbackPrefix}-${Math.random().toString(36).slice(2, 8)}`;
}
