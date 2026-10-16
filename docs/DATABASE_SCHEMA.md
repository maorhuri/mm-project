# Database schema

PostgreSQL 16 · Prisma ORM · migrations in `packages/db/prisma/migrations`.
Conventions: snake_case tables/columns, UUID v7 primary keys, `created_at` /
`updated_at` timestamps, enums for every status, every brand-scoped table has
`brand_id` (indexed, cascade on brand delete).

## Implemented in Phase 1

### Identity & access

| Table | Purpose | Key columns |
| --- | --- | --- |
| `users` | Login identities | `email` unique, `password_hash` (argon2id), `is_super_admin`, `is_active`, `mfa_enabled`, `mfa_secret_enc` |
| `sessions` | Server-side sessions | `token_hash` unique (sha256 of cookie token), `user_id`, `expires_at`, `ip_address`, `user_agent`, `last_seen_at` |
| `organizations` | Tenant root (one per company) | `slug` unique |
| `memberships` | User ↔ org with `OrgRole` (OWNER, ADMIN, MEMBER, VIEWER) | unique `(user_id, org_id)` |
| `brand_access` | Explicit per-brand grant with `BrandRole` (BRAND_ADMIN, EDITOR, VIEWER) | unique `(user_id, brand_id)` |

### Brands (tenants)

| Table | Purpose | Notes |
| --- | --- | --- |
| `brands` | One marketing workspace | unique `(org_id, slug)`, `status` ACTIVE/PAUSED/ARCHIVED, `is_demo`, locale/timezone/currency |
| `brand_settings` | 1:1 Brand Kit | JSON `colors`, `fonts`, `tone`, `audiences`, `content_targets`; arrays `keywords`, `hashtags`, `cta_presets`, `allowed_claims`, `forbidden_claims`; `publishing_mode` MANUAL/SEMI_AUTO/AUTO; `monthly_ad_budget_ils` |
| `brand_assets` | Logo/font/image slots pointing at media | `type` LOGO_PRIMARY/LOGO_SECONDARY/LOGO_ICON/FONT/BRAND_IMAGE, `media_asset_id` |
| `brand_products` | Verified products/services | unique `(brand_id, slug)`, JSON `features`, `audiences`, `price_from_ils` decimal, `pricing_note`, `is_active`, `sort_order` |
| `brand_knowledge` | Knowledge base for AI | `kind` (WEBSITE, SERVICE_PAGE, PRICING, FAQ, DOCUMENT, MANUAL, CREATIVE, CAMPAIGN_DATA), `status` PENDING/APPROVED/REJECTED, `approved_by_id`, `approved_at` |
| `brand_competitors` | Competitor list | `name`, `website_url`, `notes` |

### Media

| Table | Purpose | Notes |
| --- | --- | --- |
| `media_assets` | Files in object storage | `storage_key` unique (`brands/<brandId>/yyyy/mm/<uuid>.<ext>`), `kind` IMAGE/VIDEO/AUDIO/FONT/DOCUMENT/OTHER, `source` UPLOAD/AI_GENERATED/RENDERED/IMPORTED, `mime_type`, `size_bytes`, `width`, `height`, `duration_ms`, `tags[]`, `checksum_sha256`, `uploaded_by_id`, `deleted_at` (soft delete) |

### Approvals

| Table | Purpose | Notes |
| --- | --- | --- |
| `approvals` | Gate for publish / spend / costly AI | `type` (CONTENT_POST, VIDEO, CONTENT_PLAN, CAMPAIGN, BUDGET, AD_CHANGE, ACTIVATION, AI_HIGH_COST, BRAND_KNOWLEDGE, OTHER), `status` (PENDING, APPROVED, REJECTED, CHANGES_REQUESTED, SCHEDULED, EXECUTED, FAILED), polymorphic `subject_type`/`subject_id`/`subject_version`, `payload` JSON, `estimated_cost_ils`, `requested_by_id`, `decided_by_id`, `decided_at`, `decision_note`, `executed_at`, `error_message` |

### Integrations & operations

| Table | Purpose | Notes |
| --- | --- | --- |
| `provider_accounts` | Connected providers | `org_id`, nullable `brand_id` (null = org-wide), `provider`, `kind` (AI_TEXT, AI_IMAGE, AI_VIDEO, AI_TTS, META, GOOGLE_ADS, LINKEDIN, GOOGLE_BUSINESS, STORAGE, OTHER), `status` DISCONNECTED/CONNECTED/ERROR/EXPIRED, `credentials_enc` (AES-256-GCM JSON), `scopes[]`, `expires_at`, `last_sync_at`, `last_error` |
| `background_jobs` | Durable job execution log | `queue`, `name`, `bull_job_id`, `idempotency_key` unique, `status` QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED, `payload`, `result`, `error`, `attempts`, timings |
| `audit_logs` | Append-only trail | `org_id`, `brand_id`, `actor_user_id`, `action` (dot-namespaced), `entity_type`, `entity_id`, `before`, `after`, `metadata`, `ip_address`, `user_agent` |
| `notifications` | In-app inbox | `user_id`, `brand_id`, `level`, `title`, `body`, `link`, `read_at` |

### Indexes (Phase 1)
- `sessions(user_id)`, `sessions(expires_at)`
- `memberships(org_id)`, `brand_access(brand_id)`
- `brands(org_id, status)`
- `brand_assets(brand_id, type)`, `brand_products(brand_id, is_active)`, `brand_knowledge(brand_id, status)`, `brand_competitors(brand_id)`
- `media_assets(brand_id, kind, deleted_at)`, `media_assets(brand_id, created_at)`
- `approvals(brand_id, status, created_at)`, `approvals(subject_type, subject_id)`
- `provider_accounts(org_id, provider)`, `provider_accounts(brand_id)`
- `background_jobs(queue, status, created_at)`, `background_jobs(brand_id, created_at)`
- `audit_logs(brand_id, created_at)`, `audit_logs(actor_user_id, created_at)`, `audit_logs(entity_type, entity_id)`
- `notifications(user_id, read_at, created_at)`, `notifications(brand_id, created_at)`

## Implemented in Phase 2/3 (migration `20261016064427_phase2_phase3`)

All carry `brand_id`, are listed in `TENANT_MODELS` and cascade on brand delete.

| Table | Purpose / key columns |
| --- | --- |
| `ai_runs` | The AI cost ledger: `task` (enum), `provider`, `model_id`, `status` (RUNNING/SUCCEEDED/FAILED/BLOCKED), tokens / images / characters, `cost_ils` (Decimal 12,4), `cost_usd`, `estimated`, `latency_ms`, `prompt_hash`, `facts_hash`, `approval_id` for runs that needed an `AI_HIGH_COST` approval, `metadata` (label, mock flag). Monthly usage = SUM over the brand's SUCCEEDED/RUNNING rows |
| `content_ideas` | AI ideas: title, hook, angle, English `visual_direction`, `copy` JSON (headline/subheadline/cta/price/badge), `claims` JSON (`{text, factIds[], kind}`), `qa` report, status NEW/SELECTED/USED/DISCARDED, `source` (`ai`/`mock`), `ai_run_id`, `facts_hash`, `brief` JSON (projectId, goal…) |
| `creative_projects` | channel, format, `aspect` (R1X1/R4X5/R9X16/R16X9/R191X1), status DRAFT/IN_REVIEW/APPROVED/REJECTED/ARCHIVED, product/idea refs, goal/audience/style, `current_version_id` |
| `creative_versions` | Immutable versions: `document` JSON (CreativeDocument v1 — layers with percent boxes), `copy` (text by role), `qa`, `render_status` + `render_error` + `render_warnings`, rendered PNG/JPG/WebP media ids, status DRAFT/READY/APPROVED/REJECTED/SUPERSEDED, `approval_id`, `facts_hash`, note. Unique `(project_id, version)` |
| `strategy_briefs` | kind GOALS/AUDIENCES/CAMPAIGN_PROPOSAL/CONTENT_PLAN, `content` JSON (summary, items with basis fact ids + confidence + dataGap, dataGaps, model), `facts_hash`, `ai_run_id`, status DRAFT/ACCEPTED/ARCHIVED |
| `video_projects` | aspect, status DRAFT/SCRIPTED/RENDERING/READY/FAILED/APPROVED, `voice`, `qa`, output/voiceover media ids, `subtitles_srt`, `duration_ms`, `cost_ils`, `render_progress` / `render_step` / `render_error`, `approval_id`, `facts_hash` |
| `video_scenes` | `order` (unique per project), narration, on-screen text, `visual_kind` CARD/MEDIA/AI_IMAGE, media / visual prompt, rendered frame + audio media ids, `duration_ms` |

## Designed for later phases (added by migration when the module is built)

All carry `brand_id` and go through the tenant client.

| Phase | Table | Purpose / key columns |
| --- | --- | --- |
| 2+ | `ai_models` | Operator-editable copy of the model catalog (today the catalog is code, verified with a date) |
| 4 | `social_accounts` | Facebook Page / Instagram account per brand: external ids, encrypted tokens, scopes, expiry, health |
| 4 | `content_calendar` | Monthly plan: month, targets, status, approval_id |
| 4 | `scheduled_posts` / `published_posts` | Channel, copy variants, media, scheduled_at, idempotency key, external post id, status, error, insights snapshot |
| 4 | `automation_rules` | Trigger → condition → action definitions with enable flag and last run |
| 5 | `ad_accounts` / `campaigns` / `ad_sets` / `advertisements` | Mirror of Meta/Google objects with sync timestamps; local drafts created paused; `write_enabled` per account |
| 5 | `budgets` | Per brand/channel/month: planned, spent (platform), AI cost, infra cost, reserve, alerts |
| 5 | `integration_syncs` / `webhook_events` | Sync runs with source and freshness; inbound webhooks with signature status and processing state |
| 6 | `leads` / `lead_events` | PRD §13 fields and statuses (+ CONTINUO: TRIAL_BOOKED, TRIAL_ATTENDED, MEMBER), consent records |
| 6 | `sales` / `attribution_events` | Deal value, conversion date, campaign/ad/UTM attribution with reliability flag |

## Migration policy

- `prisma migrate dev` locally / in the dev working copy creates migrations;
  they are committed. Production runs `prisma migrate deploy` only (deploy.sh).
- Never edit an applied migration; add a new one.
- Destructive changes require a backup first (see DEPLOYMENT.md).
