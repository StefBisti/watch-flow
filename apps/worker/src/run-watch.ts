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

const MAX_SNAPSHOT_CHARS = 10_000;

const safeFetch = createSafeFetch();

const sendEmail = async (msg: EmailMessage) => {
  console.log(msg.subject, msg.html);
};

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
    select: { watch: { select: { flow: true, id: true } } },
  });
  if (run === null) return;

  const ctx: RunContext = {
    fetch: safeFetch,
    sendEmail,
    matchRegex,
    snapshots: await prevSnaphots(run.watch.id),
    commitSnapshots: (snapshots) => commitSnapshots(snapshots, run.watch.id),
    signal: AbortSignal.timeout(60_000),
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

  await prisma.$transaction([
    prisma.run.update({
      where: { id: runId },
      data: {
        status,
        error: result.error ?? null,
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
