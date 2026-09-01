import { expect, test, vi } from "vitest";
import { runFlow } from "./run-flow.ts";
import type { RunContext } from "./types.ts";
import type { EmailMessage, RegexMatch } from "../io.ts";

const runCtx = (over: Partial<RunContext> = {}): RunContext => ({
  fetch: async () => ({
    status: 200,
    headers: {},
    body: "<p>29.99</p>",
    truncated: false,
  }),
  sendEmail: async () => {},
  matchRegex: async ({ text, pattern, flags }) =>
    new RegExp(pattern, flags).exec(text) as RegexMatch | null,
  snapshots: {},
  commitSnapshots: async () => {},
  signal: new AbortController().signal,
  now: () => new Date("2026-01-01T00:00:00Z"),
  ...over,
});

/** fetch → select → compare → condition → email (true) / webhook (false) */
const basicFlow = () => ({
  version: 1,
  nodes: [
    { id: "fetch", type: "http_fetch", data: { url: "https://a.test" } },
    { id: "select", type: "css_selector", data: { selector: "p" } },
    { id: "cmp", type: "compare_last", data: {} },
    {
      id: "cond",
      type: "condition",
      data: { field: "changed", operator: "equals", value: "true" },
    },
    {
      id: "mail",
      type: "email",
      data: { subject: "Now {{value}}", body: "<p>{{value}}</p>" },
    },
    {
      id: "hook",
      type: "webhook",
      data: { url: "https://b.test/h", method: "POST", bodyTemplate: "{}" },
    },
  ],
  edges: [
    { from: "fetch", to: "select" },
    { from: "select", to: "cmp" },
    { from: "cmp", to: "cond" },
    { from: "cond", to: "mail", handle: "true" },
    { from: "cond", to: "hook", handle: "false" },
  ],
});

test("runs a flow end to end and logs every node", async () => {
  const res = await runFlow(basicFlow(), runCtx({ snapshots: { cmp: "old" } }));
  expect(res.status).toBe("ok");
  expect(res.log.map((e) => [e.nodeId, e.status])).toEqual([
    ["fetch", "ok"],
    ["select", "ok"],
    ["cmp", "ok"],
    ["cond", "ok"],
    ["mail", "ok"],
    ["hook", "skipped"],
  ]);
});

test("chains each node's output into the next node's input", async () => {
  let sent: EmailMessage | undefined;
  await runFlow(
    basicFlow(),
    runCtx({
      snapshots: { cmp: "old" },
      sendEmail: async (msg) => {
        sent = msg;
      },
    }),
  );
  // "29.99" came from fetch → css_selector → compare_last, and the condition
  // passed compare_last's object through rather than its own boolean.
  expect(sent?.subject).toBe("Now 29.99");
});

test("condition follows the false branch and skips the true branch", async () => {
  // No stored snapshot, so compare_last reports changed: false.
  const res = await runFlow(basicFlow(), runCtx());
  const status = Object.fromEntries(res.log.map((e) => [e.nodeId, e.status]));
  expect(status).toMatchObject({ cond: "ok", hook: "ok", mail: "skipped" });
});

test("🔒 does not commit snapshots when a later node throws", async () => {
  const commitSnapshots = vi.fn(async () => {});
  const res = await runFlow(
    basicFlow(),
    runCtx({
      snapshots: { cmp: "old" },
      commitSnapshots,
      sendEmail: async () => {
        throw new Error("smtp down");
      },
    }),
  );
  expect(res.status).toBe("failed");
  expect(commitSnapshots).not.toHaveBeenCalled();
  expect(res.snapshots).toEqual({});
});

test("commits snapshots exactly once on a clean run", async () => {
  const commitSnapshots = vi.fn(async () => {});
  await runFlow(
    basicFlow(),
    runCtx({ snapshots: { cmp: "old" }, commitSnapshots }),
  );
  expect(commitSnapshots).toHaveBeenCalledTimes(1);
  expect(commitSnapshots).toHaveBeenCalledWith({ cmp: "29.99" });
});

test("a throwing node fails the run, names it, and skips the rest", async () => {
  const res = await runFlow(
    basicFlow(),
    runCtx({
      fetch: async () => {
        throw new Error("dns failure");
      },
    }),
  );
  expect(res.status).toBe("failed");
  const entry = res.log.find((e) => e.nodeId === "fetch")!;
  expect(entry.status).toBe("failed");
  expect(entry.error).toMatch(/dns failure/);
  expect(res.log.filter((e) => e.status === "skipped")).toHaveLength(5);
});

test("🔒 a hanging node is stopped by the per-node timeout", async () => {
  const res = await runFlow(
    basicFlow(),
    runCtx({ nodeTimeoutMs: 20, fetch: () => new Promise(() => {}) }),
  );
  expect(res.status).toBe("failed");
  expect(res.log[0]!.error).toBe("node timed out");
});

test("🔒 a cancelled run is reported as cancelled, not as a timeout", async () => {
  const controller = new AbortController();
  const res = await runFlow(
    basicFlow(),
    runCtx({
      signal: controller.signal,
      fetch: () => {
        // Abort while the node is in flight — exercises the listener path,
        // not onAbort's already-aborted fast path.
        setTimeout(() => controller.abort(), 5);
        return new Promise(() => {});
      },
    }),
  );
  expect(res.status).toBe("failed");
  expect(res.log[0]!.error).toBe("run cancelled");
});

test("keeps the run log when committing snapshots fails", async () => {
  const res = await runFlow(
    basicFlow(),
    runCtx({
      snapshots: { cmp: "old" },
      commitSnapshots: async () => {
        throw new Error("db down");
      },
    }),
  );
  expect(res.status).toBe("failed");
  expect(res.error).toMatch(/db down/);
  expect(res.log.some((e) => e.status === "ok")).toBe(true);
});

test("throws, rather than failing, when the flow itself is invalid", async () => {
  await expect(
    runFlow({ version: 1, nodes: [], edges: [] }, runCtx()),
  ).rejects.toThrow();
});

test("🔒 stores a snapshot for a node id of __proto__", async () => {
  const flow = basicFlow();
  flow.nodes[2]!.id = "__proto__";
  flow.edges[1]!.to = "__proto__";
  flow.edges[2]!.from = "__proto__";
  const res = await runFlow(flow, runCtx());
  expect(Object.keys(res.snapshots)).toEqual(["__proto__"]);
  expect(res.snapshots["__proto__"]).toBe("29.99");
});

test("🔒 a node id of constructor has no previous value on the first run", async () => {
  const flow = basicFlow();
  flow.nodes[2]!.id = "constructor";
  flow.edges[1]!.to = "constructor";
  flow.edges[2]!.from = "constructor";
  const res = await runFlow(flow, runCtx());
  const entry = res.log.find((e) => e.nodeId === "constructor")!;
  expect(entry.output).toContain('"changed":false');
});
