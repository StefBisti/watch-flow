import { z } from "zod";
import { MAX_EDGES, MAX_NODE_ID, MAX_NODES } from "./limits.ts";
import { FlowNodeType } from "./nodes/types.ts";
import {
  CompareLastConfig,
  ConditionConfig,
  CssSelectorConfig,
  EmailConfig,
  HttpFetchConfig,
  JsonPathConfig,
  RegexConfig,
  WebhookConfig,
} from "./nodes/config.ts";

const NodeId = z
  .string()
  .min(1)
  .max(MAX_NODE_ID)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid node id");
const Position = z.object({ x: z.number(), y: z.number() }).strict();

function nodeVariant<T extends FlowNodeType, S extends z.ZodType>(
  type: T,
  data: S,
) {
  return z
    .object({
      id: NodeId,
      type: z.literal(type),
      data,
      position: Position.optional(),
    })
    .strict();
}

export const FlowNode = z.discriminatedUnion("type", [
  nodeVariant("http_fetch", HttpFetchConfig),
  nodeVariant("css_selector", CssSelectorConfig),
  nodeVariant("json_path", JsonPathConfig),
  nodeVariant("regex", RegexConfig),
  nodeVariant("compare_last", CompareLastConfig.default({})),
  nodeVariant("condition", ConditionConfig),
  nodeVariant("email", EmailConfig),
  nodeVariant("webhook", WebhookConfig),
]);
export type FlowNode = z.infer<typeof FlowNode>;

const _everyNodeTypeIsCovered: [
  Exclude<FlowNodeType, FlowNode["type"]>,
] extends [never]
  ? true
  : never = true;
void _everyNodeTypeIsCovered;

export const FlowEdge = z
  .object({
    from: NodeId,
    to: NodeId,
    handle: z.enum(["true", "false"]).optional(),
  })
  .strict();
export type FlowEdge = z.infer<typeof FlowEdge>;

export const FlowSchema = z
  .object({
    version: z.literal(1),
    nodes: z.array(FlowNode).min(1).max(MAX_NODES),
    edges: z.array(FlowEdge).max(MAX_EDGES),
  })
  .strict()
  .superRefine((flow, ctx) => {
    if (flow.nodes.length > MAX_NODES || flow.edges.length > MAX_EDGES) return;

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

    // no duplicate edges
    const seenEdges = new Set<string>();
    let duplicateEdge = false;
    flow.edges.forEach((edge, i) => {
      const key = `${edge.from}\u0000${edge.to}\u0000${edge.handle ?? ""}`;
      if (seenEdges.has(key)) {
        duplicateEdge = true;
        ctx.addIssue({
          code: "custom",
          message: `Duplicate edge from "${edge.from}" to "${edge.to}"`,
          path: ["edges", i],
        });
      }
      seenEdges.add(key);
    });
    if (duplicateEdge) return;

    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    const adj = new Map<string, string[]>();
    const outgoing = new Map<string, typeof flow.edges>();
    const incomingCnt = new Map<string, number>();
    for (const edge of flow.edges) {
      const next = adj.get(edge.from);
      if (next) next.push(edge.to);
      else adj.set(edge.from, [edge.to]);

      const out = outgoing.get(edge.from);
      if (out) out.push(edge);
      else outgoing.set(edge.from, [edge]);

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

    // handle is present if and only if the source node is a condition, and distinct
    for (const [fromId, edges] of outgoing) {
      const isCondition = byId.get(fromId)?.type === "condition";
      const handles = new Set<string>();
      for (const edge of edges) {
        if (!isCondition && edge.handle !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: `Only condition nodes have handles: "${fromId}"`,
            path: ["edges"],
          });
        }
        if (isCondition) {
          if (edge.handle === undefined) {
            ctx.addIssue({
              code: "custom",
              message: `Edge out of condition node "${fromId}" needs a true or false handle`,
              path: ["edges"],
            });
          } else if (handles.has(edge.handle)) {
            ctx.addIssue({
              code: "custom",
              message: `Condition node "${fromId}" has two "${edge.handle}" branches`,
              path: ["edges"],
            });
          } else {
            handles.add(edge.handle);
          }
        }
      }
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
