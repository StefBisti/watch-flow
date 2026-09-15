import { Redis } from "ioredis";
import { HOST_RATE_LIMIT, HOST_RATE_WINDOW_MS } from "@watchflow/security";
import { env } from "./env.ts";

export const redis = new Redis(env.REDIS_URL);

/**
 * Fixed-window counter shared by every worker process: one Redis key per
 * hostname per window. MULTI runs INCR and PEXPIRE as one atomic step, so a
 * crash between them can't leave a counter that never expires.
 */
export async function allowHost(hostname: string): Promise<boolean> {
  const bucket = Math.floor(Date.now() / HOST_RATE_WINDOW_MS);
  const key = `wf:rl:${hostname}:${bucket}`;
  const replies = await redis
    .multi()
    .incr(key)
    .pexpire(key, HOST_RATE_WINDOW_MS * 2)
    .exec();
  // replies is [[error, result], ...]: the first entry is INCR's new count.
  const count = replies?.[0]?.[1];

  return typeof count === "number" && count <= HOST_RATE_LIMIT;
}
