-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN     "music_media_id" UUID,
ADD COLUMN     "music_volume" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "transitions" BOOLEAN NOT NULL DEFAULT true;
