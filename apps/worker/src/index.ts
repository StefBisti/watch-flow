import { Queue, Worker } from "bullmq";
import { env } from "./env.ts";
import { prisma } from "@watchflow/db";
import { runWatch } from "./run-watch.ts";

/////////////////////////////////////////////////////////////// queue & worker

type WatchJob = { runId: string };

const connection = { url: env.REDIS_URL };

const queue = new Queue<WatchJob>("watch-runs", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1_000 },
  },
});

const worker = new Worker<WatchJob>(
  "watch-runs",
  async (job) => await runWatch(job.data.runId),
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error("job failed", job?.id, err);

  if (!job) return;

  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

  void prisma.run
    .update({
      where: { id: job.data.runId },
      data: { status: "failed", error: "worker error", endedAt: new Date() },
    })
    .catch((e) => console.error("could not mark run failed", job.id, e));
});

/////////////////////////////////////////////////////////////// ticker

const fetchWatches = () =>
  prisma.watch.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
    select: { id: true, intervalMin: true },
  });

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;

  try {
    const watches = await fetchWatches();

    for (const w of watches) {
      await prisma.watch.update({
        where: { id: w.id },
        data: {
          nextRunAt: new Date(Date.now() + w.intervalMin * 60 * 1000),
        },
      });

      const run = await prisma.run.create({
        data: {
          watchId: w.id,
          status: "pending",
          triggered: "schedule",
          log: [],
        },
      });

      await queue.add("run", { runId: run.id }, { jobId: run.id });
    }
  } catch (err) {
    console.log(err);
  } finally {
    ticking = false;
  }
}
const tickerId = setInterval(tick, 60_000);
tick();

/////////////////////////////////////////////////////////////// shutdown

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
