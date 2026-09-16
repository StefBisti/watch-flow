import { NextResponse } from "next/server";
import { HEARTBEAT_KEY } from "@watchflow/security";
import { watchRunsQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = watchRunsQueue();
    // Reuse BullMQ's own connection instead of opening a second one.
    const client = await queue.getBackend().client;

    const [beat, counts] = await Promise.all([
      client.get(HEARTBEAT_KEY),
      queue.getJobCounts("waiting", "active", "delayed", "failed"),
    ]);

    // Key present = alive. Redis expired it or it didn't: one clock, no skew.
    const up = beat !== null;

    return NextResponse.json(
      {
        status: up ? "ok" : "degraded",
        worker: { up, lastBeatAgeMs: beat ? Date.now() - Number(beat) : null },
        queue: counts,
        version: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      },
      { status: up ? 200 : 503, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // Deliberately message-free: ioredis errors embed the connection URL.
    return NextResponse.json(
      { status: "error" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
