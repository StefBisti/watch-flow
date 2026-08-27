import { expect, test } from "vitest";
import { FlowSchema } from "./schema.ts";
import { MAX_NODES } from "./limits.ts";

const DEFAULT_DATA: Record<string, unknown> = {
  http_fetch: { url: "https://example.com" },
  css_selector: { selector: ".price" },
  json_path: { path: "$.price" },
  regex: { pattern: "\\d+" },
  compare_last: {},
  condition: { field: "changed", operator: "equals", value: "true" },
  email: { subject: "Changed", body: "New: {{value}}" },
  webhook: {
    url: "https://example.com/hook",
    method: "POST",
    bodyTemplate: "{}",
  },
};

type TestNode = { id: string; type: string; data?: unknown };
type TestEdge = { from: string; to: string; handle?: "true" | "false" };
type TestFlow = { version: number; nodes: TestNode[]; edges: TestEdge[] };

const node = (id: string, type: string, data?: unknown): TestNode => ({
  id,
  type,
  data: data ?? DEFAULT_DATA[type],
});

const validFlow = (): TestFlow => ({
  version: 1,
  nodes: [
    node("fetch", "http_fetch"),
    node("select", "css_selector"),
    node("notify", "email"),
  ],
  edges: [
    { from: "fetch", to: "select" },
    { from: "select", to: "notify" },
  ],
});

/** Asserts the flow is rejected AND that the expected rule is what rejected it. */
const rejectsWith = (flow: unknown, match: RegExp) => {
  const result = FlowSchema.safeParse(flow);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.map((i) => i.message).join("\n")).toMatch(match);
};

test("accepts a valid flow", () => {
  expect(FlowSchema.safeParse(validFlow()).success).toBe(true);
});

test("returns parsed, typed node config", () => {
  const parsed = FlowSchema.parse(validFlow());
  const fetchNode = parsed.nodes[0]!;
  if (fetchNode.type !== "http_fetch") throw new Error("wrong node");
  expect(fetchNode.data.url).toBe("https://example.com");
});

/* ---------------------------------------------------------- graph rules --- */

test("rejects duplicate node ids", () => {
  const flow = validFlow();
  flow.nodes.push(node("fetch", "webhook"));
  rejectsWith(flow, /Duplicate node id/);
});

test("rejects an edge pointing at a missing node", () => {
  const flow = validFlow();
  flow.edges.push({ from: "notify", to: "ghost" });
  rejectsWith(flow, /references unknown node/);
});

test("reports duplicate edges as duplicates, not as fan-in", () => {
  const flow = validFlow();
  flow.edges.push({ from: "select", to: "notify" });
  rejectsWith(flow, /Duplicate edge/);
});

test("rejects a flow with no http_fetch node", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "regex");
  rejectsWith(flow, /exactly one http_fetch/);
});

test("rejects two http_fetch nodes", () => {
  const flow = validFlow();
  flow.nodes.push(node("fetch2", "http_fetch"));
  flow.edges.push({ from: "fetch2", to: "notify" });
  rejectsWith(flow, /exactly one http_fetch/);
});

test("rejects an incoming edge into the source", () => {
  const flow = validFlow();
  flow.nodes.push(node("extra", "regex"));
  flow.edges.push(
    { from: "notify", to: "extra" },
    { from: "extra", to: "fetch" },
  );
  rejectsWith(flow, /cannot have incoming edges/);
});

test("rejects fan-in", () => {
  const flow = validFlow();
  flow.nodes.push(node("re", "regex"));
  flow.edges.push({ from: "fetch", to: "re" }, { from: "re", to: "notify" });
  rejectsWith(flow, /fan-in is not allowed/);
});

test("rejects a cycle", () => {
  const flow = validFlow();
  flow.nodes.push(node("a", "regex"), node("b", "regex"));
  flow.edges.push({ from: "a", to: "b" }, { from: "b", to: "a" });
  rejectsWith(flow, /Cycle detected/);
});

test("rejects an unreachable node", () => {
  const flow = validFlow();
  flow.nodes.push(node("orphan", "webhook"));
  rejectsWith(flow, /not reachable/);
});

test("rejects a flow with no action node", () => {
  const flow = validFlow();
  flow.nodes[2] = node("notify", "regex");
  rejectsWith(flow, /at least one action node/);
});

/* -------------------------------------------------------------- handles --- */

test("rejects a handle on a non-condition node", () => {
  const flow = validFlow();
  flow.edges[1] = { from: "select", to: "notify", handle: "true" };
  rejectsWith(flow, /Only condition nodes have handles/);
});

test("rejects a condition branch with no handle", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "condition");
  rejectsWith(flow, /needs a true or false handle/);
});

test("rejects two identical condition handles", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "condition");
  flow.nodes.push(node("notify2", "webhook"));
  flow.edges[1] = { from: "select", to: "notify", handle: "true" };
  flow.edges.push({ from: "select", to: "notify2", handle: "true" });
  rejectsWith(flow, /two "true" branches/);
});

/* --------------------------------------------------------------- config --- */

test("rejects unknown keys anywhere", () => {
  const flow = validFlow() as Record<string, unknown>;
  flow.secretExtra = "top";
  rejectsWith(flow, /[Uu]nrecognized key/);
});

test("rejects an unknown key in node config", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "css_selector", {
    selector: ".p",
    timeout: 999,
  });
  rejectsWith(flow, /[Uu]nrecognized key/);
});

test("rejects a non-http protocol", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", { url: "file:///etc/passwd" });
  rejectsWith(flow, /http and https/);
});

test("rejects a loopback URL", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", { url: "http://127.0.0.1/" });
  rejectsWith(flow, /must not point at private/);
});

test("rejects the cloud metadata endpoint", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "http://169.254.169.254/latest/",
  });
  rejectsWith(flow, /must not point at private/);
});

test("rejects credentials in a URL", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "https://user:pass@example.com/",
  });
  rejectsWith(flow, /must not contain credentials/);
});

test("rejects a URL over the cap", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: `https://example.com/${"a".repeat(2100)}`,
  });
  rejectsWith(flow, /too long|at most|2048/i);
});

test("rejects CRLF in a header name", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "https://example.com",
    headers: { "X-A\r\nHost": "evil" },
  });
  // z.record swallows the key schema's own message; revisit if the form needs
  // to point at the offending header by name.
  rejectsWith(flow, /Invalid key in record/);
});

test("rejects CRLF in a header value", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "https://example.com",
    headers: { "X-A": "v\r\nHost: internal" },
  });
  rejectsWith(flow, /printable ASCII/);
});

test("rejects a forbidden header", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "https://example.com",
    headers: { Host: "internal" },
  });
  rejectsWith(flow, /may not be set/);
});

test("rejects a catastrophic-backtracking pattern", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "regex", { pattern: "(a+)+$" });
  rejectsWith(flow, /catastrophic backtracking/);
});

test("rejects an unparseable pattern", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "regex", { pattern: "(" });
  rejectsWith(flow, /valid regular expression/);
});

test("rejects duplicate regex flags", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "regex", { pattern: "a", flags: "gg" });
  rejectsWith(flow, /valid regular expression/);
});

test("accepts the d and v regex flags", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "regex", { pattern: "a", flags: "dv" });
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});

test("rejects gt on a string value", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "condition", {
    field: "price",
    operator: "gt",
    value: "10",
  });
  rejectsWith(flow, /require valueType 'number'/);
});

test("rejects a non-numeric value when valueType is number", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "condition", {
    field: "price",
    operator: "gt",
    value: "cheap",
    valueType: "number",
  });
  rejectsWith(flow, /must be numeric/);
});

test("allows compare_last to omit data", () => {
  const flow = validFlow();
  flow.nodes[1] = { id: "select", type: "compare_last" } as never;
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});

test("rejects more nodes than the cap", () => {
  const flow = validFlow();
  for (let i = 0; i < MAX_NODES; i++) flow.nodes.push(node(`n${i}`, "regex"));
  rejectsWith(flow, /too big|at most|25/i);
});

test("rejects IPv4-mapped IPv6 loopback", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "http://[::ffff:127.0.0.1]/",
  });
  rejectsWith(flow, /must not point at private/);
});
test("rejects decimal-encoded loopback", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "http://2130706433/",
  });
  rejectsWith(flow, /must not point at private/);
});
test("allows a domain starting with fc", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "http_fetch", {
    url: "https://fc-barcelona.com/",
  });
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});

test("allows fan-out from a non-condition node", () => {
  const flow = validFlow();
  flow.nodes.push(node("hook", "webhook"));
  flow.edges.push({ from: "select", to: "hook" });
  expect(FlowSchema.safeParse(flow).success).toBe(true);
});
