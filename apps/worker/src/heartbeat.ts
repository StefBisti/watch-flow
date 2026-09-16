import { HEARTBEAT_KEY } from "@watchflow/security";
import { redis } from "./host-limit.ts";

const INTERVAL_MS = 30_000;
const TTL_S = 120;

export async function beat() {
  try {
    await redis.set(HEARTBEAT_KEY, Date.now().toString(), "EX", TTL_S);
  } catch (err) {
    // A missed beat must never take the worker down — it would turn a
    // blip in Redis into the very outage the heartbeat is meant to report.
    console.error("heartbeat failed", err);
  }
}

export function startHeartbeat() {
  void beat(); // immediately, so a fresh deploy is visible at once
  return setInterval(() => void beat(), INTERVAL_MS);
}
