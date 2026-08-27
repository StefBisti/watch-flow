import z from "zod";

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
