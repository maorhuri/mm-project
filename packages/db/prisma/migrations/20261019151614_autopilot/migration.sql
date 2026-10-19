-- AlterTable
ALTER TABLE "brand_settings" ADD COLUMN     "autopilot" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "creative_projects" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'manual';
