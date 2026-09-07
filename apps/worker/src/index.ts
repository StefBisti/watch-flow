import { Queue, Worker } from "bullmq";
import { env } from "./env.ts";

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

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, closing`);

  try {
    await worker.close();
    console.log("worker closed");
    await queue.close();
    console.log("queue closed");
  } catch (err) {
    console.log("shutdown failed", err);
    process.exitCode = 1;
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, shutdown);
}
