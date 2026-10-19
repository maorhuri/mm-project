import { z } from 'zod';

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, digits and dashes');

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');

export const emailSchema = z.string().trim().toLowerCase().email();

/** http(s) URLs only — rendered as links, so javascript:/data: schemes are refused. */
export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), { message: 'Only http(s) URLs are allowed' });
export const passwordSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

/** 6-digit TOTP or a recovery code (xxxxx-xxxxx). */
export const mfaCodeSchema = z
  .string()
  .trim()
  .min(6)
  .max(16)
  .regex(/^[A-Za-z0-9 -]+$/, 'Invalid code');

export const mfaVerifySchema = z.object({ code: mfaCodeSchema });

export const mfaDisableSchema = z.object({
  password: z.string().min(1),
  code: mfaCodeSchema,
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
  websiteUrl: httpUrlSchema.optional().or(z.literal('')),
  isDemo: z.boolean().optional(),
});

export const brandUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  websiteUrl: httpUrlSchema.nullable().optional().or(z.literal('')),
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
  url: httpUrlSchema.nullable().optional().or(z.literal('')),
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
  sourceUrl: httpUrlSchema.nullable().optional().or(z.literal('')),
  content: z.string().trim().min(1).max(100_000),
});

export const competitorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  websiteUrl: httpUrlSchema.nullable().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const brandAssetSchema = z.object({
  type: z.enum(['LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON', 'FONT', 'BRAND_IMAGE']),
  mediaAssetId: z.string().uuid(),
  label: z.string().trim().max(80).nullable().optional(),
});

/** Accepts "mvn.co.il" as well as full URLs: a bare host gets https:// prepended; other schemes are refused. */
export const websiteUrlInputSchema = z.preprocess(
  (v: unknown) => {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (!s) return undefined;
    return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  },
  httpUrlSchema.optional(),
);

export const websiteAnalyzeSchema = z.object({
  url: websiteUrlInputSchema,
});

export const brandImportApplySchema = z.object({
  colors: brandColorsSchema.optional(),
  fonts: brandFontsSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  logo: z
    .object({
      url: httpUrlSchema,
      type: z.enum(['LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON']),
    })
    .optional(),
  sourceUrl: httpUrlSchema.optional(),
});

export const aiProviderIdSchema = z.enum(['openai', 'anthropic', 'google', 'fal']);

export const providerCredentialsSchema = z.object({
  provider: aiProviderIdSchema,
  apiKey: z.string().trim().min(10).max(500),
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

export const approvalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SCHEDULED', 'EXECUTED', 'FAILED']);
export const approvalTypeSchema = z.enum([
  'CONTENT_POST',
  'VIDEO',
  'CONTENT_PLAN',
  'CAMPAIGN',
  'BUDGET',
  'AD_CHANGE',
  'ACTIVATION',
  'AI_HIGH_COST',
  'BRAND_KNOWLEDGE',
  'OTHER',
]);

export const approvalListQuerySchema = z.object({
  status: approvalStatusSchema.optional(),
  type: approvalTypeSchema.optional(),
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

// ---------------------------------------------------------------------------
// Phase 2 — Creative Studio, strategy briefs; Phase 3 — Video Studio
// ---------------------------------------------------------------------------
import { aspectRatioSchema } from './creative/document';
export const creativeChannelSchema = z.enum(['FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'LINKEDIN', 'GENERIC']);
export const creativeFormatSchema = z.enum(['POST', 'STORY', 'BANNER', 'AD']);
export const creativeTemplateSchema = z.enum(['bold', 'photo', 'clean']);

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const creativeProjectSchema = z.object({
  title: z.string().trim().min(2, 'כותרת קצרה מדי').max(120),
  channel: creativeChannelSchema.default('GENERIC'),
  format: creativeFormatSchema.default('POST'),
  aspect: aspectRatioSchema.default('R1X1'),
  productId: z.string().uuid().nullable().optional(),
  goal: optionalText(500),
  audience: optionalText(300),
  style: optionalText(300),
});

export const ideaRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
  productId: z.string().uuid().nullable().optional(),
  count: z.coerce.number().int().min(1).max(8).default(4),
  goal: optionalText(500),
  audience: optionalText(300),
  extra: optionalText(1000),
});

export const creativeCopySchema = z.object({
  headline: z.string().trim().min(1, 'חובה כותרת').max(120),
  subheadline: optionalText(200),
  body: optionalText(400),
  cta: optionalText(40),
  price: optionalText(40),
  badge: optionalText(30),
});

export const composeCreativeSchema = z.object({
  ideaId: z.string().uuid().optional(),
  template: creativeTemplateSchema.default('bold'),
  backgroundMediaId: z.string().uuid().nullable().optional(),
  copy: creativeCopySchema,
  note: optionalText(300),
});

export const backgroundRequestSchema = z.object({
  prompt: z.string().trim().min(3, 'תיאור קצר מדי').max(1500),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const saveVersionSchema = z.object({
  document: z.unknown(),
  note: optionalText(300),
});

export const ideaStatusSchema = z.enum(['NEW', 'SELECTED', 'USED', 'DISCARDED']);

export const briefKindSchema = z.enum(['GOALS', 'AUDIENCES', 'CAMPAIGN_PROPOSAL', 'CONTENT_PLAN']);
export const briefRequestSchema = z.object({
  kind: briefKindSchema,
  focus: optionalText(500),
});
export const briefStatusSchema = z.enum(['DRAFT', 'ACCEPTED', 'ARCHIVED']);

/** OpenAI text-to-speech voices (platform.openai.com/docs/guides/text-to-speech). */
export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;
export const ttsVoiceSchema = z.enum(TTS_VOICES);

export const videoProjectSchema = z.object({
  title: z.string().trim().min(2, 'כותרת קצרה מדי').max(120),
  goal: optionalText(500),
  productId: z.string().uuid().nullable().optional(),
  aspect: aspectRatioSchema.default('R9X16'),
  voice: ttsVoiceSchema.default('alloy'),
});

export const videoScriptRequestSchema = z.object({
  sceneCount: z.coerce.number().int().min(2).max(8).default(5),
  targetSeconds: z.coerce.number().int().min(10).max(90).default(30),
  extra: optionalText(2000),
  defaultKind: z.enum(['CARD', 'AI_IMAGE', 'AI_VIDEO']).optional(),
});

export const autoVideoSchema = z.object({
  brief: z.string().trim().min(8, 'תארו בכמה מילים על מה הסרטון').max(1500),
  aspect: z.enum(['R9X16', 'R1X1', 'R4X5', 'R16X9']).default('R9X16'),
  productId: z.string().uuid().nullable().optional(),
  characterId: z.string().uuid().nullable().optional(),
  sceneCount: z.coerce.number().int().min(3).max(8).default(5),
  targetSeconds: z.coerce.number().int().min(15).max(60).default(30),
  videoTier: z.enum(['economy', 'balanced', 'flagship']).default('flagship'),
  voice: z.string().max(20).optional(),
});

export const sceneVisualKindSchema = z.enum(['CARD', 'MEDIA', 'AI_IMAGE', 'MEDIA_VIDEO', 'AI_VIDEO', 'AVATAR']);

export const videoSceneUpdateSchema = z.object({
  narration: z.string().trim().min(1, 'חובה קריינות').max(600),
  onScreenText: optionalText(120),
  visualKind: sceneVisualKindSchema.default('CARD'),
  mediaId: z.string().uuid().nullable().optional(),
  visualPrompt: optionalText(800),
  motionPrompt: optionalText(500),
  characterId: z.string().uuid().nullable().optional(),
});

export const videoTierSchema = z.enum(['economy', 'balanced', 'flagship']);

export const videoSettingsSchema = z.object({
  voice: ttsVoiceSchema,
  motionStills: z.boolean(),
  videoTier: videoTierSchema,
  ambientAudio: z.boolean(),
  transitions: z.boolean(),
  musicMediaId: z.string().uuid().nullable().optional(),
  musicVolume: z.coerce.number().int().min(0).max(100).default(18),
});

export const characterSchema = z.object({
  name: z.string().trim().min(2, 'שם קצר מדי').max(60),
  description: optionalText(800),
  imageMediaId: z.string().uuid('בחרו תמונה לדמות'),
  voice: ttsVoiceSchema.default('alloy'),
  voiceInstructions: optionalText(300),
});

export const characterImageRequestSchema = z.object({
  description: z.string().trim().min(5, 'תארו את הדמות').max(800),
  style: optionalText(300),
});

export type CreativeProjectInput = z.infer<typeof creativeProjectSchema>;
export type IdeaRequestInput = z.infer<typeof ideaRequestSchema>;
export type CreativeCopyInput = z.infer<typeof creativeCopySchema>;
export type ComposeCreativeInput = z.infer<typeof composeCreativeSchema>;
export type BackgroundRequestInput = z.infer<typeof backgroundRequestSchema>;
export type SaveVersionInput = z.infer<typeof saveVersionSchema>;
export type BriefRequestInput = z.infer<typeof briefRequestSchema>;
export type VideoProjectInput = z.infer<typeof videoProjectSchema>;
export type VideoScriptRequestInput = z.infer<typeof videoScriptRequestSchema>;
export type VideoSceneUpdateInput = z.infer<typeof videoSceneUpdateSchema>;
export type VideoSettingsInput = z.infer<typeof videoSettingsSchema>;
export type CharacterInput = z.infer<typeof characterSchema>;
export type CharacterImageRequestInput = z.infer<typeof characterImageRequestSchema>;

// ---------------------------------------------------------------------------
// Meta (Facebook) integration
// ---------------------------------------------------------------------------
export const metaAppCredentialsSchema = z.object({
  appId: z.string().trim().regex(/^\d{5,32}$/, 'App ID הוא מספר'),
  /** Empty = keep the stored secret. */
  appSecret: z.string().trim().max(256).default(''),
  configId: z.string().trim().regex(/^\d{5,32}$/, 'Configuration ID הוא מספר').nullable().optional(),
});
export const metaSelectSchema = z.object({
  adAccountId: z.string().uuid().optional(),
  pageId: z.string().trim().regex(/^\d*$/).optional(),
});
export type MetaAppCredentialsInput = z.infer<typeof metaAppCredentialsSchema>;
export type MetaSelectInput = z.infer<typeof metaSelectSchema>;

// ---------------------------------------------------------------------------
// Phase 4 — posts
// ---------------------------------------------------------------------------
export const socialChannelSchema = z.enum(['FACEBOOK_PAGE', 'INSTAGRAM']);
export const postSchema = z.object({
  channels: z.array(socialChannelSchema).min(1, 'בחרו לפחות ערוץ אחד'),
  caption: z.string().max(5000).default(''),
  mediaId: z.string().uuid().nullable().optional(),
  sourceType: z.enum(['creative_version', 'video_project', 'media']).nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'בחרו תאריך ושעה'),
});
export const postUpdateSchema = z.object({
  caption: z.string().max(5000).default(''),
  mediaId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'בחרו תאריך ושעה'),
});
export const captionRequestSchema = z.object({ channel: socialChannelSchema, brief: z.string().trim().min(3, 'תארו את הפוסט').max(1500) });
