import { Prisma, prisma } from "@watchflow/db";
import {
  EmailMessage,
  runFlow,
  RunContext,
  RegexMatch,
  RegexRequest,
  RunResult,
} from "@watchflow/flow";
import {
  createSafeFetch,
  decryptSecret,
  parseMasterKey,
  redact,
  withSecrets,
  RateLimitedError,
} from "@watchflow/security";
import { Resend } from "resend";
import { env } from "./env.ts";
import { allowHost } from "./host-limit.ts";

const MAX_SNAPSHOT_CHARS = 10_000;
const RUN_TIMEOUT_MS = 60_000;

const resend = new Resend(env.RESEND_API_KEY);

const safeFetch = createSafeFetch({ allowHost });

// Parsed once at boot: a malformed key crashes the worker on start, not mid-run.
const masterKey = parseMasterKey(env.SECRETS_MASTER_KEY);

const commitSnapshots = async (
  snapshots: Record<string, string>,
  watchId: string,
) => {
  await prisma.snapshot.createMany({
    data: Object.entries(snapshots).map(([nodeId, value]) => ({
      watchId,
      nodeId,
      value: value.slice(0, MAX_SNAPSHOT_CHARS),
    })),
  });
};

const sendEmail = async (msg: EmailMessage, email: string) => {
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: email,
    subject: msg.subject,
    html: msg.html,
  });
  if (error) throw new Error(`resend: ${error.message}`);
};

const matchRegex = async (req: RegexRequest) => {
  return new RegExp(req.pattern, req.flags).exec(req.text) as RegexMatch | null;
};

async function prevSnaphots(watchId: string): Promise<Record<string, string>> {
  const res = await prisma.$queryRaw<{ nodeId: string; value: string }[]>`
    SELECT DISTINCT ON ("nodeId") "nodeId", "value"
    FROM "Snapshot"
    WHERE "watchId" = ${watchId}
    ORDER BY "nodeId", "createdAt" DESC
  `;
  return Object.fromEntries(res.map((r) => [r.nodeId, r.value]));
}

async function loadSecrets(watchId: string): Promise<Record<string, string>> {
  const rows = await prisma.watchSecret.findMany({
    where: { watchId },
    select: { name: true, iv: true, ciphertext: true },
  });
  return Object.fromEntries(
    rows.map((r) => [
      r.name,
      decryptSecret(
        // Prisma 7 returns Bytes as Uint8Array; decryptSecret calls Buffer
        // methods (.toString("utf8")) on it, so convert back.
        { iv: Buffer.from(r.iv), ciphertext: Buffer.from(r.ciphertext) },
        masterKey,
        watchId, // AAD — must equal what the web action bound it to
      ),
    ]),
  );
}

/**
 * Runs one watch. Returns true when the run was DEFERRED: its first request
 * hit a host's rate limit, nothing has happened yet, and the job should be
 * retried in a later window instead of being recorded as a failure.
 */
export async function runWatch(runId: string): Promise<boolean> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      watch: {
        select: { flow: true, id: true, user: { select: { email: true } } },
      },
    },
  });
  if (run === null) return false;

  await prisma.run.update({
    where: { id: runId },
    data: { status: "running" },
  });

  // 🔒 Only a limit hit on the FIRST request is safe to retry: that request
  // is always the source http_fetch, a GET that runs before any email or
  // webhook. A limit hit later may come after an email already went out, and
  // a retry would send it twice — so that case fails like any other error.
  let completedRequests = 0;
  let deferred = false;
  const countingFetch: typeof safeFetch = async (req) => {
    try {
      const res = await safeFetch(req);
      completedRequests++;
      return res;
    } catch (e) {
      if (e instanceof RateLimitedError && completedRequests === 0) {
        deferred = true;
      }
      throw e;
    }
  };

  // Declared outside the try: the final redact needs it even when the try
  // threw before secrets were loaded (it then stays empty, which is correct —
  // nothing was decrypted, so nothing can leak).
  let secretValues: string[] = [];
  let result: RunResult;
  try {
    // Inside the try: an undecryptable secret (bad rotation, tampered row)
    // becomes an ordinary failed run with Watch.lastStatus updated, instead
    // of the job dying in BullMQ and the dashboard showing a stale status.
    const secrets = await loadSecrets(run.watch.id);
    secretValues = Object.values(secrets);

    const ctx: RunContext = {
      fetch: withSecrets(countingFetch, secrets),
      sendEmail: (msg) => sendEmail(msg, run.watch.user.email),
      matchRegex,
      snapshots: await prevSnaphots(run.watch.id),
      commitSnapshots: (snapshots) => commitSnapshots(snapshots, run.watch.id),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      runTimeoutMs: RUN_TIMEOUT_MS,
      now: () => new Date(),
    };

    result = await runFlow(run.watch.flow, ctx);
  } catch (e) {
    result = {
      status: "failed",
      log: [],
      snapshots: {},
      error: e instanceof Error ? e.message : String(e),
    };
  }

  if (deferred) {
    // Back in the queue: nothing ran, so there is nothing to record yet.
    await prisma.run.update({
      where: { id: runId },
      data: { status: "pending" },
    });
    return true;
  }

  const status = result.status === "ok" ? "success" : "failed";
  const error =
    result.error ??
    result.log.find((e) => e.status === "failed")?.error ??
    null;

  await prisma.$transaction([
    prisma.run.update({
      where: { id: runId },
      data: {
        status,
        // copied out of the log BEFORE redaction, so it needs scrubbing too
        error: error === null ? null : (redact(error, secretValues) as string),
        endedAt: new Date(),
        log: redact(result.log, secretValues) as Prisma.InputJsonValue,
      },
    }),
    prisma.watch.update({
      where: { id: run.watch.id },
      data: { lastRunAt: new Date(), lastStatus: status },
    }),
  ]);
  return false;
}
