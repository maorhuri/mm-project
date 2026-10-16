-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('PROVIDER_PROBE', 'CREATIVE_IDEAS', 'CREATIVE_COPY', 'CREATIVE_BACKGROUND', 'QA_CLAIM_JUDGE', 'STRATEGY_BRIEF', 'VIDEO_SCRIPT', 'TTS', 'OTHER');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('NEW', 'SELECTED', 'USED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "CreativeChannel" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'LINKEDIN', 'GENERIC');

-- CreateEnum
CREATE TYPE "CreativeFormat" AS ENUM ('POST', 'STORY', 'BANNER', 'AD');

-- CreateEnum
CREATE TYPE "AspectRatio" AS ENUM ('R1X1', 'R4X5', 'R9X16', 'R16X9', 'R191X1');

-- CreateEnum
CREATE TYPE "CreativeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('PENDING', 'RENDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BriefKind" AS ENUM ('GOALS', 'AUDIENCES', 'CAMPAIGN_PROPOSAL', 'CONTENT_PLAN');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('DRAFT', 'SCRIPTED', 'RENDERING', 'READY', 'FAILED', 'APPROVED');

-- CreateEnum
CREATE TYPE "SceneVisualKind" AS ENUM ('CARD', 'MEDIA', 'AI_IMAGE');

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "task" "AiTaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "images" INTEGER,
    "characters" INTEGER,
    "cost_ils" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6),
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "prompt_hash" TEXT,
    "facts_hash" TEXT,
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requested_by_id" UUID,
    "approval_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_ideas" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "angle" TEXT,
    "visual_direction" TEXT,
    "copy" JSONB NOT NULL DEFAULT '{}',
    "claims" JSONB NOT NULL DEFAULT '[]',
    "qa" JSONB,
    "status" "IdeaStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "ai_run_id" UUID,
    "facts_hash" TEXT,
    "brief" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_projects" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "channel" "CreativeChannel" NOT NULL DEFAULT 'GENERIC',
    "format" "CreativeFormat" NOT NULL DEFAULT 'POST',
    "aspect" "AspectRatio" NOT NULL DEFAULT 'R1X1',
    "status" "CreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "product_id" UUID,
    "idea_id" UUID,
    "goal" TEXT,
    "audience" TEXT,
    "style" TEXT,
    "current_version_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_versions" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "copy" JSONB NOT NULL DEFAULT '{}',
    "qa" JSONB,
    "render_status" "RenderStatus" NOT NULL DEFAULT 'PENDING',
    "render_error" TEXT,
    "render_warnings" JSONB,
    "rendered_png_id" UUID,
    "rendered_jpg_id" UUID,
    "rendered_webp_id" UUID,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_id" UUID,
    "facts_hash" TEXT,
    "note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_briefs" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "kind" "BriefKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "facts_hash" TEXT,
    "ai_run_id" UUID,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_projects" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT,
    "product_id" UUID,
    "aspect" "AspectRatio" NOT NULL DEFAULT 'R9X16',
    "status" "VideoStatus" NOT NULL DEFAULT 'DRAFT',
    "voice" TEXT NOT NULL DEFAULT 'alloy',
    "language" TEXT NOT NULL DEFAULT 'he',
    "voiceover_media_id" UUID,
    "output_media_id" UUID,
    "subtitles_srt" TEXT,
    "duration_ms" INTEGER,
    "cost_ils" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "render_progress" INTEGER NOT NULL DEFAULT 0,
    "render_step" TEXT,
    "render_error" TEXT,
    "qa" JSONB,
    "approval_id" UUID,
    "facts_hash" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_scenes" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "narration" TEXT NOT NULL,
    "on_screen_text" TEXT,
    "visual_kind" "SceneVisualKind" NOT NULL DEFAULT 'CARD',
    "media_id" UUID,
    "visual_prompt" TEXT,
    "rendered_image_id" UUID,
    "audio_media_id" UUID,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_runs_brand_id_created_at_idx" ON "ai_runs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_brand_id_status_idx" ON "ai_runs"("brand_id", "status");

-- CreateIndex
CREATE INDEX "content_ideas_brand_id_status_created_at_idx" ON "content_ideas"("brand_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "creative_projects_brand_id_status_updated_at_idx" ON "creative_projects"("brand_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "creative_versions_brand_id_status_idx" ON "creative_versions"("brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "creative_versions_project_id_version_key" ON "creative_versions"("project_id", "version");

-- CreateIndex
CREATE INDEX "strategy_briefs_brand_id_kind_created_at_idx" ON "strategy_briefs"("brand_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "video_projects_brand_id_status_updated_at_idx" ON "video_projects"("brand_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "video_scenes_project_id_order_key" ON "video_scenes"("project_id", "order");

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_projects" ADD CONSTRAINT "creative_projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "creative_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "video_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
