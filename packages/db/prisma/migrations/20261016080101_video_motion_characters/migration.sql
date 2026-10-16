-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiTaskType" ADD VALUE 'VIDEO_CLIP';
ALTER TYPE "AiTaskType" ADD VALUE 'AVATAR_VIDEO';
ALTER TYPE "AiTaskType" ADD VALUE 'CHARACTER_IMAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SceneVisualKind" ADD VALUE 'MEDIA_VIDEO';
ALTER TYPE "SceneVisualKind" ADD VALUE 'AI_VIDEO';
ALTER TYPE "SceneVisualKind" ADD VALUE 'AVATAR';

-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "video_seconds" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN     "ambient_audio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimate_ils" DECIMAL(12,4),
ADD COLUMN     "motion_stills" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "render_approval_id" UUID,
ADD COLUMN     "video_tier" TEXT NOT NULL DEFAULT 'balanced';

-- AlterTable
ALTER TABLE "video_scenes" ADD COLUMN     "character_id" UUID,
ADD COLUMN     "clip_media_id" UUID,
ADD COLUMN     "clip_meta" JSONB,
ADD COLUMN     "motion_prompt" TEXT;

-- CreateTable
CREATE TABLE "brand_characters" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_media_id" UUID NOT NULL,
    "voice" TEXT NOT NULL DEFAULT 'alloy',
    "voice_instructions" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_characters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_characters_brand_id_is_active_idx" ON "brand_characters"("brand_id", "is_active");

-- AddForeignKey
ALTER TABLE "brand_characters" ADD CONSTRAINT "brand_characters_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
