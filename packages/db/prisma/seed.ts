import { prisma } from "../src/index.js";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "dev@watchflow.local" },
    update: {},
    create: {
      email: "dev@watchflow.local",
      name: "Dev User",
      role: "admin",
    },
  });

  await prisma.watch.upsert({
    where: { id: "seed-watch-1" },
    update: {},
    create: {
      id: "seed-watch-1",
      userId: user.id,
      name: "Example — Hacker News front page",
      flow: { version: 1, nodes: [], edges: [] },
      intervalMin: 15,
      nextRunAt: new Date(),
    },
  });

  console.log("seeded:", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
