import { expect, test } from "vitest";
import { FlowSchema } from "./schema.ts";

const node = (id: string, type: string, data: unknown = {}) => ({
  id,
  type,
  data,
});

const validFlow = () => ({
  version: 1,
  nodes: [
    node("fetch", "http_fetch", { url: "https://example.com" }),
    node("select", "css_selector", { selector: ".price" }),
    node("notify", "email", {
      subject: "changed",
      body: "new value: {{value}}",
    }),
  ],
  edges: [
    { from: "fetch", to: "select" },
    { from: "select", to: "notify" },
  ],
});

const rejects = (flow: unknown) =>
  expect(FlowSchema.safeParse(flow).success).toBe(false);

test("accepts a valid flow", () => {
  expect(FlowSchema.safeParse(validFlow()).success).toBe(true);
});

test("rejects an unknown node type", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "rm_rf");
  rejects(flow);
});

test("rejects duplicate node ids", () => {
  const flow = validFlow();
  flow.nodes.push(node("fetch", "webhook"));
  rejects(flow);
});

test("rejects an edge pointing at a missing node", () => {
  const flow = validFlow();
  flow.edges.push({ from: "notify", to: "ghost" });
  rejects(flow);
});

test("rejects a flow with no http_fetch node", () => {
  const flow = validFlow();
  flow.nodes[0] = node("fetch", "css_selector");
  rejects(flow);
});

test("rejects a flow with two http_fetch nodes", () => {
  const flow = validFlow();
  flow.nodes.push(node("fetch2", "http_fetch"));
  rejects(flow);
});

test("rejects an incoming edge into the source", () => {
  const flow = validFlow();
  flow.edges.push({ from: "notify", to: "fetch" });
  rejects(flow);
});

test("rejects fan-in", () => {
  const flow = validFlow();
  flow.nodes.push(node("regex", "regex"));
  flow.edges.push(
    { from: "fetch", to: "regex" },
    { from: "regex", to: "notify" },
  );
  rejects(flow); // notify now has two incoming edges
});

test("rejects a cycle", () => {
  const flow = validFlow();
  flow.nodes.push(node("a", "regex"), node("b", "regex"));
  flow.edges.push({ from: "a", to: "b" }, { from: "b", to: "a" });
  rejects(flow);
});

test("rejects an unreachable node", () => {
  const flow = validFlow();
  flow.nodes.push(node("orphan", "webhook"));
  rejects(flow);
});

test("rejects a flow with no action node", () => {
  const flow = validFlow();
  flow.nodes[2] = node("notify", "regex");
  rejects(flow);
});

test("rejects more nodes than the cap", () => {
  const flow = validFlow();
  for (let i = 0; i < 30; i++) flow.nodes.push(node(`n${i}`, "regex"));
  rejects(flow);
});

test("rejects an unknown key in node config", () => {
  const flow = validFlow();
  flow.nodes[1].data = { selector: ".price", timeout: 999999 };
  rejects(flow);
});

test("rejects a non-http protocol", () => {
  const flow = validFlow();
  flow.nodes[0].data = { url: "file:///etc/passwd" };
  rejects(flow);
});

test("rejects an over-long selector", () => {
  const flow = validFlow();
  flow.nodes[1].data = { selector: "a".repeat(600) };
  rejects(flow);
});

test("rejects invalid regex flags", () => {
  const flow = validFlow();
  flow.nodes[1] = node("select", "regex", { pattern: "\\d+", flags: "gx" });
  rejects(flow);
});
