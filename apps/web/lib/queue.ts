import "server-only";
import { Queue } from "bullmq";
import { env } from "./env";

export type WatchJob = { runId: string };

const QUEUE = "watch-runs";

const globalForQueue = globalThis as unknown as {
  watchRuns?: Queue<WatchJob>;
};

export function watchRunsQueue(): Queue<WatchJob> {
  globalForQueue.watchRuns ??= new Queue<WatchJob>(QUEUE, {
    connection: { url: env.REDIS_URL },
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1_000 },
    },
  });
  return globalForQueue.watchRuns;
}
