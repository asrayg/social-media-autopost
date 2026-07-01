-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "apiAccessToken" TEXT,
ADD COLUMN     "apiOpenId" TEXT,
ADD COLUMN     "apiRefreshToken" TEXT,
ADD COLUMN     "apiScope" TEXT,
ADD COLUMN     "apiTokenExpiresAt" TIMESTAMP(3);
