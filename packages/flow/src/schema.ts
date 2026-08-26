import { z } from "zod";
import { MAX_EDGES, MAX_NODES } from "./limits.ts";

export const FlowNodeType = z.enum([
  "http_fetch",
  "css_selector",
  "json_path",
  "regex",
  "compare_last",
  "condition",
  "email",
  "webhook",
]);
export type FlowNodeType = z.infer<typeof FlowNodeType>;

export const FlowNode = z.object({
  id: z.string().min(1).max(64),
  type: FlowNodeType,
  data: z.unknown(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type FlowNode = z.infer<typeof FlowNode>;

export const FlowEdge = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  handle: z.enum(["true", "false"]).optional(),
});
export type FlowEdge = z.infer<typeof FlowEdge>;

export const FlowSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(FlowNode).min(1).max(MAX_NODES),
    edges: z.array(FlowEdge).max(MAX_EDGES),
  })
  .superRefine((flow, ctx) => {
    // no duplicate ids
    const ids = new Set<string>();
    let duplicated = false;
    flow.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        duplicated = true;
        ctx.addIssue({
          code: "custom",
          message: `Duplicate node id "${node.id}"`,
          path: ["nodes", i, "id"],
        });
      }
      ids.add(node.id);
    });
    if (duplicated) return;

    // no dangling edges
    let dangling = false;
    flow.edges.forEach((edge, i) => {
      for (const end of ["from", "to"] as const) {
        if (!ids.has(edge[end])) {
          dangling = true;
          ctx.addIssue({
            code: "custom",
            message: `Edge ${end} references unknown node "${edge[end]}"`,
            path: ["edges", i, end],
          });
        }
      }
    });
    if (dangling) return;

    const adj = new Map<string, string[]>();
    const incomingCnt = new Map<string, number>();
    for (const edge of flow.edges) {
      adj.set(edge.from, [...(adj.get(edge.from) ?? []), edge.to]);
      incomingCnt.set(edge.to, (incomingCnt.get(edge.to) ?? 0) + 1);
    }

    // exactly one http_fetch and it's the source
    const sources = flow.nodes.filter((n) => n.type === "http_fetch");
    if (sources.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `A flow needs exactly one http_fetch node, found ${sources.length}`,
        path: ["nodes"],
      });
      return;
    }
    const source = sources[0];
    if ((incomingCnt.get(source.id) ?? 0) > 0) {
      ctx.addIssue({
        code: "custom",
        message: "The http_fetch node cannot have incoming edges",
        path: ["nodes"],
      });
    }

    // no fan-in
    for (const [id, count] of incomingCnt) {
      if (count > 1) {
        ctx.addIssue({
          code: "custom",
          message: `Node "${id}" has ${count} incoming edges; fan-in is not allowed`,
          path: ["edges"],
        });
      }
    }

    // no cycles
    const visited = new Set<string>();
    const inStack = new Set<string>();
    let cyclic = false;
    const visit = (id: string): void => {
      if (cyclic || visited.has(id)) return;
      inStack.add(id);
      for (const next of adj.get(id) ?? []) {
        if (inStack.has(next)) {
          cyclic = true;
          ctx.addIssue({
            code: "custom",
            message: `Cycle detected at node "${next}"`,
            path: ["edges"],
          });
          break;
        }
        visit(next);
      }
      inStack.delete(id);
      visited.add(id);
    };
    for (const node of flow.nodes) visit(node.id);
    if (cyclic) return;

    // every node is reachable from the source
    const reachable = new Set<string>();
    const queue = [source.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      queue.push(...(adj.get(id) ?? []));
    }
    for (const node of flow.nodes) {
      if (!reachable.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Node "${node.id}" is not reachable from http_fetch node`,
          path: ["nodes"],
        });
      }
    }

    // at least one action node
    if (!flow.nodes.some((n) => n.type === "email" || n.type === "webhook")) {
      ctx.addIssue({
        code: "custom",
        message: "A flow needs at least one action node",
        path: ["nodes"],
      });
    }
  });
export type FlowSchema = z.infer<typeof FlowSchema>;
