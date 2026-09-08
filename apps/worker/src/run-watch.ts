import { Prisma, prisma } from "@watchflow/db";
import {
  EmailMessage,
  runFlow,
  RunContext,
  RegexMatch,
  RegexRequest,
  RunResult,
} from "@watchflow/flow";
import { createSafeFetch, redact } from "@watchflow/security";
import { Resend } from "resend";
import { env } from "./env.ts";

const MAX_SNAPSHOT_CHARS = 10_000;
const RUN_TIMEOUT_MS = 60_000;

const resend = new Resend(env.RESEND_API_KEY);

const safeFetch = createSafeFetch();

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

export async function runWatch(runId: string) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      watch: {
        select: { flow: true, id: true, user: { select: { email: true } } },
      },
    },
  });
  if (run === null) return;

  await prisma.run.update({
    where: { id: runId },
    data: { status: "running" },
  });

  const ctx: RunContext = {
    fetch: safeFetch,
    sendEmail: (msg) => sendEmail(msg, run.watch.user.email),
    matchRegex,
    snapshots: await prevSnaphots(run.watch.id),
    commitSnapshots: (snapshots) => commitSnapshots(snapshots, run.watch.id),
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    runTimeoutMs: RUN_TIMEOUT_MS,
    now: () => new Date(),
  };

  let result: RunResult;
  try {
    result = await runFlow(run.watch.flow, ctx);
  } catch (e) {
    result = {
      status: "failed",
      log: [],
      snapshots: {},
      error: e instanceof Error ? e.message : String(e),
    };
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
        error: error,
        endedAt: new Date(),
        log: redact(result.log) as Prisma.InputJsonValue,
      },
    }),
    prisma.watch.update({
      where: { id: run.watch.id },
      data: { lastRunAt: new Date(), lastStatus: status },
    }),
  ]);
}
