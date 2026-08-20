/*
  Warnings:

  - The `role` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `lastStatus` column on the `Watch` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `channel` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `Run` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `triggered` on the `Run` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('schedule', 'manual');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'webhook');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "channel",
ADD COLUMN     "channel" "NotificationChannel" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "NotificationStatus" NOT NULL;

-- AlterTable
ALTER TABLE "Run" DROP COLUMN "status",
ADD COLUMN     "status" "RunStatus" NOT NULL,
DROP COLUMN "triggered",
ADD COLUMN     "triggered" "RunTrigger" NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionToken");

-- DropIndex
DROP INDEX "Session_sessionToken_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "Watch" DROP COLUMN "lastStatus",
ADD COLUMN     "lastStatus" "RunStatus";

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
