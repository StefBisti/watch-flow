import z from "zod";
import { RegexConfig } from "../config.ts";
import { defineNode } from "../registry.ts";
import { MAX_NODE_OUTPUT, MAX_REGEX_INPUT } from "../../limits.ts";

const TextInput = z.union([z.string(), z.object({ body: z.string() })]);

export const regexNode = defineNode({
  configSchema: RegexConfig,
  execute: async (input, config) => {
    const parsed = TextInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("regex expects text, as a string or {body}");
    }
    const text = (
      typeof parsed.data === "string" ? parsed.data : parsed.data.body
    ).slice(0, MAX_REGEX_INPUT);

    let re: RegExp;
    try {
      re = new RegExp(config.pattern, config.flags);
    } catch {
      throw new Error("regex pattern is not valid");
    }

    const match = re.exec(text);
    if (!match) return null;
    return (match[1] ?? match[0]).slice(0, MAX_NODE_OUTPUT);
  },
});
