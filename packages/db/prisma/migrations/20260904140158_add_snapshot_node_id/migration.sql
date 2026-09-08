/*
  Warnings:

  - You are about to drop the column `hash` on the `Snapshot` table. All the data in the column will be lost.
  - Added the required column `nodeId` to the `Snapshot` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Snapshot_watchId_createdAt_idx";

-- AlterTable
ALTER TABLE "Snapshot" DROP COLUMN "hash",
ADD COLUMN     "nodeId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Snapshot_watchId_nodeId_createdAt_idx" ON "Snapshot"("watchId", "nodeId", "createdAt");
