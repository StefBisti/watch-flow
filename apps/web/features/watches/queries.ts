import { requireUser } from "@/lib/authz";
import { prisma } from "@watchflow/db";
import "server-only";

export async function listWatches() {
  const user = await requireUser();
  return await prisma.watch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      enabled: true,
      intervalMin: true,
      lastStatus: true,
    },
  });
}

export async function getWatch(watchId: string) {
  const user = await requireUser();
  return await prisma.watch.findFirst({
    where: {
      userId: user.id,
      id: watchId,
    },
  });
}
