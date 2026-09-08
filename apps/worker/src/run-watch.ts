import { prisma } from "@watchflow/db";
import {
  EmailMessage,
  runFlow,
  RunContext,
  RegexMatch,
  RegexRequest,
} from "@watchflow/flow";
import { createSafeFetch } from "@watchflow/security";

const safeFetch = createSafeFetch();

const sendEmail = async (msg: EmailMessage) => {
  console.log(msg.subject, msg.html);
};

const commitSnapshot = async (snapshots: Record<string, string>) => {
  console.log("snapshot committed\n", snapshots);
};

const matchRegex = async (req: RegexRequest) => {
  return new RegExp(req.pattern, req.flags).exec(req.text) as RegexMatch | null;
};

const snapshots: Record<string, string> = {};

export async function runWatch(runId: string) {
  console.log("processing ", runId);

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { watch: { select: { flow: true, id: true } } },
  });

  if (run === null) return;

  const ctx: RunContext = {
    fetch: safeFetch,
    sendEmail: sendEmail,
    commitSnapshots: commitSnapshot,
    matchRegex: matchRegex,
    signal: AbortSignal.timeout(60_000),
    now: () => new Date(),
    snapshots: snapshots,
  };

  try {
    const result = await runFlow(run.watch.flow, ctx);
    console.log(result);
  } catch {}
}
