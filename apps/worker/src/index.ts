import { Queue, Worker } from "bullmq";
import { env } from "./env.ts";
import { prisma } from "@watchflow/db";

type WatchJob = { watchId: string };

const connection = { url: env.REDIS_URL };

const queue = new Queue<WatchJob>("watch-runs", { connection });

const worker = new Worker<WatchJob>(
  "watch-runs",
  async (job) => {
    console.log("processing", job.id, job.data);
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.log("job failed", job?.id, err);
});

/////////////////////////////////////////////////////////////// ticker

const fetchWatches = () =>
  prisma.watch.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
    select: { id: true },
  });

async function tick() {
  try {
    const watches = await fetchWatches();
    console.log(watches);
  } catch (err) {
    console.log(err);
  }
}
const tickerId = setInterval(tick, 60_000);
tick();

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, closing`);

  try {
    clearInterval(tickerId);
    await worker.close();
    console.log("Worker closed");
    await queue.close();
    console.log("Queue closed");
    await prisma.$disconnect();
  } catch (err) {
    console.log("shutdown failed", err);
    process.exitCode = 1;
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, shutdown);
}
