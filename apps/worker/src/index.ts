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

await queue.add("run", { watchId: "seed-watch-stef" });
