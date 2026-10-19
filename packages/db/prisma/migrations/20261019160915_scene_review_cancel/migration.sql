-- AlterTable
ALTER TABLE "video_projects" ADD COLUMN     "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "video_scenes" ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false;
