import type { NodeContext } from "../nodes/context.ts";
import type { NodeDefinition } from "../nodes/definition.ts";
import { nodeRegistry } from "../nodes/registry.ts";
import { FlowSchema } from "../schema.ts";
import { MAX_NODE_OUTPUT } from "../limits.ts";
import type { NodeLogEntry, RunContext, RunResult } from "./types.ts";

const DEFAULT_NODE_TIMEOUT_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 30_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function preview(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return JSON.stringify(value)?.slice(0, MAX_NODE_OUTPUT);
}

function onAbort(signal: AbortSignal, reason: () => string): Promise<never> {
  const p = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new Error(reason()));
    signal.addEventListener("abort", () => reject(new Error(reason())), {
      once: true,
    });
  });
  p.catch(() => {});
  return p;
}

export async function runFlow(
  flow: unknown,
  ctx: RunContext,
): Promise<RunResult> {
  const data = FlowSchema.parse(flow);

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, typeof data.edges>();
  for (const edge of data.edges) {
    const list = outgoing.get(edge.from);
    if (list) list.push(edge);
    else outgoing.set(edge.from, [edge]);
  }

  const nodeTimeoutMs = ctx.nodeTimeoutMs ?? DEFAULT_NODE_TIMEOUT_MS;
  const runTimeout = AbortSignal.timeout(
    ctx.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
  );
  const runSignal = AbortSignal.any([ctx.signal, runTimeout]);

  const pending: Record<string, string> = Object.create(null);
  const log: NodeLogEntry[] = [];
  const visited = new Set<string>();
  let status: RunResult["status"] = "ok";
  let runError: string | undefined;

  const source = data.nodes.find((n) => n.type === "http_fetch")!;
  const queue: { id: string; input: unknown }[] = [
    { id: source.id, input: null },
  ];

  while (queue.length > 0) {
    const { id, input } = queue.shift()!;
    const node = byId.get(id)!;
    visited.add(id);

    const startedAt = Date.now();
    const nodeTimeout = AbortSignal.timeout(nodeTimeoutMs);
    const signal = AbortSignal.any([runSignal, nodeTimeout]);
    const reason = () =>
      ctx.signal.aborted
        ? "run cancelled"
        : runTimeout.aborted
          ? "run timed out"
          : "node timed out";

    const nodeCtx: NodeContext = {
      fetch: (req) => ctx.fetch({ ...req, signal: req.signal ?? signal }),
      matchRegex: (req) =>
        ctx.matchRegex({ ...req, signal: req.signal ?? signal }),
      sendEmail: ctx.sendEmail,
      now: ctx.now,
      signal,
      previous: Object.hasOwn(ctx.snapshots, id) ? ctx.snapshots[id] : null,
      saveSnapshot: async (value) => {
        pending[id] = value;
      },
    };

    try {
      const definition = nodeRegistry[node.type] as NodeDefinition<unknown>;
      const config = definition.configSchema.parse(node.data);

      const output = await Promise.race([
        definition.execute(input, config, nodeCtx),
        onAbort(signal, reason),
      ]);

      log.push({
        nodeId: id,
        type: node.type,
        status: "ok",
        durationMs: Date.now() - startedAt,
        output: preview(output),
      });

      for (const edge of outgoing.get(id) ?? []) {
        if (node.type === "condition") {
          if (edge.handle === (output === true ? "true" : "false")) {
            queue.push({ id: edge.to, input });
          }
        } else {
          queue.push({ id: edge.to, input: output });
        }
      }
    } catch (e) {
      status = "failed";
      log.push({
        nodeId: id,
        type: node.type,
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: message(e),
      });
      break;
    }
  }

  for (const node of data.nodes) {
    if (!visited.has(node.id)) {
      log.push({
        nodeId: node.id,
        type: node.type,
        status: "skipped",
        durationMs: 0,
      });
    }
  }

  let snapshots: Record<string, string> = {};
  if (status === "ok" && Object.keys(pending).length > 0) {
    try {
      await ctx.commitSnapshots(pending);
      snapshots = { ...pending };
    } catch (e) {
      status = "failed";
      runError = `commitSnapshots failed: ${message(e)}`;
    }
  }

  return { status, log, snapshots, error: runError };
}
