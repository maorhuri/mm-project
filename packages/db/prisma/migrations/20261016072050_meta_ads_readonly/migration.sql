-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "timezone" TEXT,
    "account_status" INTEGER,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "provider_account_id" UUID,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "ad_account_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT,
    "effective_status" TEXT,
    "daily_budget" DECIMAL(14,2),
    "lifetime_budget" DECIMAL(14,2),
    "start_time" TIMESTAMP(3),
    "stop_time" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "effective_status" TEXT,
    "daily_budget" DECIMAL(14,2),
    "lifetime_budget" DECIMAL(14,2),
    "optimization_goal" TEXT,
    "billing_event" TEXT,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "raw" JSONB NOT NULL DEFAULT '{}',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisements" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "ad_set_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "effective_status" TEXT,
    "creative_id" TEXT,
    "thumbnail_url" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_insights" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "object_external_id" TEXT NOT NULL,
    "object_name" TEXT,
    "date" DATE NOT NULL,
    "spend" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "cpc" DECIMAL(14,4),
    "cpm" DECIMAL(14,4),
    "ctr" DECIMAL(10,4),
    "actions" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_syncs" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_by_id" UUID,

    CONSTRAINT "integration_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_brand_id_provider_external_id_key" ON "ad_accounts"("brand_id", "provider", "external_id");

-- CreateIndex
CREATE INDEX "campaigns_brand_id_effective_status_idx" ON "campaigns"("brand_id", "effective_status");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_ad_account_id_external_id_key" ON "campaigns"("ad_account_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sets_campaign_id_external_id_key" ON "ad_sets"("campaign_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "advertisements_ad_set_id_external_id_key" ON "advertisements"("ad_set_id", "external_id");

-- CreateIndex
CREATE INDEX "ad_insights_brand_id_level_date_idx" ON "ad_insights"("brand_id", "level", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_insights_brand_id_provider_level_object_external_id_date_key" ON "ad_insights"("brand_id", "provider", "level", "object_external_id", "date");

-- CreateIndex
CREATE INDEX "integration_syncs_brand_id_provider_started_at_idx" ON "integration_syncs"("brand_id", "provider", "started_at");

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_ad_set_id_fkey" FOREIGN KEY ("ad_set_id") REFERENCES "ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_insights" ADD CONSTRAINT "ad_insights_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_syncs" ADD CONSTRAINT "integration_syncs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
