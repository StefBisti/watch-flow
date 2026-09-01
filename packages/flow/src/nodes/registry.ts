import type { FlowNode } from "../schema.ts";
import type { FlowNodeType } from "./types.ts";
import { httpFetchNode } from "./execute/http-fetch.ts";
import { cssSelectorNode } from "./execute/css-selector.ts";
import { webhookNode } from "./execute/webhook.ts";
import { jsonPathNode } from "./execute/json-path.ts";
import { regexNode } from "./execute/regex.ts";
import { conditionNode } from "./execute/condition.ts";
import { emailNode } from "./execute/email.ts";
import { compareLastNode } from "./execute/compare-last.ts";
import type { NodeDefinition } from "./definition.ts";

export type ConfigOf<K extends FlowNodeType> = Extract<
  FlowNode,
  { type: K }
>["data"];

export type NodeRegistry = {
  [K in FlowNodeType]: NodeDefinition<ConfigOf<K>>;
};

export const nodeRegistry: NodeRegistry = {
  http_fetch: httpFetchNode,
  css_selector: cssSelectorNode,
  webhook: webhookNode,
  json_path: jsonPathNode,
  regex: regexNode,
  condition: conditionNode,
  email: emailNode,
  compare_last: compareLastNode,
};
