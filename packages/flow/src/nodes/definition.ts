import z from "zod";
import type { NodeContext } from "./context.ts";

export type NodeDefinition<TConfig> = {
  configSchema: z.ZodType<TConfig>;
  execute: (
    input: unknown,
    config: TConfig,
    ctx: NodeContext,
  ) => Promise<unknown>;
};

export const defineNode = <TConfig>(
  def: NodeDefinition<TConfig>,
): NodeDefinition<TConfig> => {
  return def;
};
