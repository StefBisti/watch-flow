import z from "zod";
import { CompareLastConfig } from "../config.ts";
import { defineNode } from "../registry.ts";
import { MAX_NODE_OUTPUT } from "../../limits.ts";

const CompareLastInput = z.union([z.string(), z.number()]);

export type CompareLastOutput = {
  changed: boolean;
  value: string;
  previous: string | null;
};

export const compareLastNode = defineNode({
  configSchema: CompareLastConfig,
  execute: async (input, _config, ctx): Promise<CompareLastOutput> => {
    const parsed = CompareLastInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("compare_last expects a string or a number");
    }

    const value = String(parsed.data).slice(0, MAX_NODE_OUTPUT);
    const previous = ctx.previous;

    await ctx.saveSnapshot(value);

    return {
      changed: previous !== null && previous !== value,
      value,
      previous,
    };
  },
});
