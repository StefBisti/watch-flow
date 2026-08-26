import z from "zod";
import { FlowNodeType } from "./types.ts";
import {
  CompareLastConfig,
  ConditionConfig,
  CssSelectorConfig,
  EmailConfig,
  HttpFetchConfig,
  JsonPathConfig,
  RegexConfig,
  WebhookConfig,
} from "./config.ts";

export type NodeDefinition = { configSchema: z.ZodType };

export const nodeRegistry: Record<FlowNodeType, NodeDefinition> = {
  http_fetch: { configSchema: HttpFetchConfig },
  css_selector: { configSchema: CssSelectorConfig },
  json_path: { configSchema: JsonPathConfig },
  regex: { configSchema: RegexConfig },
  compare_last: { configSchema: CompareLastConfig },
  condition: { configSchema: ConditionConfig },
  email: { configSchema: EmailConfig },
  webhook: { configSchema: WebhookConfig },
};
