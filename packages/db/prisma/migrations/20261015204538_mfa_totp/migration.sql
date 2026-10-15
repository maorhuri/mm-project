-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enrolled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_last_used_step" INTEGER,
ADD COLUMN     "mfa_recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
