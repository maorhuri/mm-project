-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "BrandRole" AS ENUM ('BRAND_ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PublishingMode" AS ENUM ('MANUAL', 'SEMI_AUTO', 'AUTO');

-- CreateEnum
CREATE TYPE "BrandAssetType" AS ENUM ('LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON', 'FONT', 'BRAND_IMAGE');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('WEBSITE', 'SERVICE_PAGE', 'PRICING', 'FAQ', 'DOCUMENT', 'MANUAL', 'CREATIVE', 'CAMPAIGN_DATA');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'FONT', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'AI_GENERATED', 'RENDERED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('CONTENT_POST', 'VIDEO', 'CONTENT_PLAN', 'CAMPAIGN', 'BUDGET', 'AD_CHANGE', 'ACTIVATION', 'AI_HIGH_COST', 'BRAND_KNOWLEDGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SCHEDULED', 'EXECUTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('AI_TEXT', 'AI_IMAGE', 'AI_VIDEO', 'AI_TTS', 'META', 'GOOGLE_ADS', 'LINKEDIN', 'GOOGLE_BUSINESS', 'STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret_enc" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_access" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "role" "BrandRole" NOT NULL DEFAULT 'EDITOR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE',
    "industry" TEXT,
    "description" TEXT,
    "website_url" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'he-IL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_settings" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "colors" JSONB NOT NULL DEFAULT '{}',
    "fonts" JSONB NOT NULL DEFAULT '{}',
    "tone" JSONB NOT NULL DEFAULT '{}',
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta_presets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbidden_claims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "graphic_style" TEXT,
    "publishing_mode" "PublishingMode" NOT NULL DEFAULT 'SEMI_AUTO',
    "content_targets" JSONB NOT NULL DEFAULT '{}',
    "monthly_ad_budget_ils" DECIMAL(12,2),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "BrandAssetType" NOT NULL,
    "label" TEXT,
    "media_asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_products" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "price_from_ils" DECIMAL(12,2),
    "pricing_note" TEXT,
    "url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_knowledge" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" "KnowledgeKind" NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "content" TEXT NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_competitors" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
    "storage_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "original_name" TEXT NOT NULL,
    "title" TEXT,
    "alt_text" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checksum_sha256" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "estimated_cost_ils" DECIMAL(12,2),
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "executed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_accounts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "brand_id" UUID,
    "provider" TEXT NOT NULL,
    "kind" "ProviderKind" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "external_account_id" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credentials_enc" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "brand_id" UUID,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bull_job_id" TEXT,
    "idempotency_key" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "org_id" UUID,
    "brand_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "brand_id" UUID,
    "level" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_org_id_idx" ON "memberships"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_org_id_key" ON "memberships"("user_id", "org_id");

-- CreateIndex
CREATE INDEX "brand_access_brand_id_idx" ON "brand_access"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_access_user_id_brand_id_key" ON "brand_access"("user_id", "brand_id");

-- CreateIndex
CREATE INDEX "brands_org_id_status_idx" ON "brands"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "brands_org_id_slug_key" ON "brands"("org_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "brand_settings_brand_id_key" ON "brand_settings"("brand_id");

-- CreateIndex
CREATE INDEX "brand_assets_brand_id_type_idx" ON "brand_assets"("brand_id", "type");

-- CreateIndex
CREATE INDEX "brand_products_brand_id_is_active_idx" ON "brand_products"("brand_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "brand_products_brand_id_slug_key" ON "brand_products"("brand_id", "slug");

-- CreateIndex
CREATE INDEX "brand_knowledge_brand_id_status_idx" ON "brand_knowledge"("brand_id", "status");

-- CreateIndex
CREATE INDEX "brand_competitors_brand_id_idx" ON "brand_competitors"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_brand_id_kind_deleted_at_idx" ON "media_assets"("brand_id", "kind", "deleted_at");

-- CreateIndex
CREATE INDEX "media_assets_brand_id_created_at_idx" ON "media_assets"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "approvals_brand_id_status_created_at_idx" ON "approvals"("brand_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approvals_subject_type_subject_id_idx" ON "approvals"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "provider_accounts_org_id_provider_idx" ON "provider_accounts"("org_id", "provider");

-- CreateIndex
CREATE INDEX "provider_accounts_brand_id_idx" ON "provider_accounts"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_idempotency_key_key" ON "background_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "background_jobs_queue_status_created_at_idx" ON "background_jobs"("queue", "status", "created_at");

-- CreateIndex
CREATE INDEX "background_jobs_brand_id_created_at_idx" ON "background_jobs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_brand_id_created_at_idx" ON "audit_logs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_brand_id_created_at_idx" ON "notifications"("brand_id", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_access" ADD CONSTRAINT "brand_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_access" ADD CONSTRAINT "brand_access_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_settings" ADD CONSTRAINT "brand_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_knowledge" ADD CONSTRAINT "brand_knowledge_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_competitors" ADD CONSTRAINT "brand_competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
