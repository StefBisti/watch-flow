import { JSONPath } from "jsonpath-plus";
import { JsonPathConfig } from "../config.ts";
import { defineNode } from "../registry.ts";
import z from "zod";
import { MAX_NODE_OUTPUT } from "../../limits.ts";

const JsonInput = z.union([z.string(), z.object({ body: z.string() })]);
type JsonValue = null | boolean | number | string | object;

function toOutput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export const jsonPathNode = defineNode({
  configSchema: JsonPathConfig,
  execute: async (input, config) => {
    const parsed = JsonInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("json_path expects JSON, as a string or { body }");
    }
    const text =
      typeof parsed.data === "string" ? parsed.data : parsed.data.body;

    let json: JsonValue;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("json_path input is not valid JSON");
    }

    let matches: unknown[];
    try {
      matches = JSONPath<unknown[]>({ path: config.path, json, eval: false });
    } catch {
      throw new Error("json_path could not evaluate that path");
    }

    if (matches.length === 0) return null;
    return toOutput(matches[0]).slice(0, MAX_NODE_OUTPUT);
  },
});
