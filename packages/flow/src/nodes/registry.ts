import z from "zod";
import { FlowNode } from "../schema.ts";
import { FlowNodeType } from "./types.ts";

export type NodeDefinition = { configSchema: z.ZodType };

const definitions: Record<string, NodeDefinition> = Object.fromEntries(
  FlowNode.options.map((option) => [
    option.shape.type.value,
    { configSchema: option.shape.data },
  ]),
);

export const nodeRegistry = definitions as Record<FlowNodeType, NodeDefinition>;
