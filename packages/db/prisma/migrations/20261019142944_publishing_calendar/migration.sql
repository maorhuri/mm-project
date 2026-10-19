-- CreateEnum
CREATE TYPE "SocialChannel" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostMediaType" AS ENUM ('NONE', 'IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "scheduled_posts" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "caption" TEXT NOT NULL,
    "media_type" "PostMediaType" NOT NULL DEFAULT 'NONE',
    "media_id" UUID,
    "source_type" TEXT,
    "source_id" UUID,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "content_hash" TEXT NOT NULL,
    "approval_id" UUID,
    "external_id" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_posts_brand_id_scheduled_at_idx" ON "scheduled_posts"("brand_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "scheduled_posts_status_scheduled_at_idx" ON "scheduled_posts"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
