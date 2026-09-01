import z from "zod";
import { defineNode } from "../registry.ts";
import { WebhookConfig } from "../config.ts";
import Mustache from "mustache";
import { MAX_WEBHOOK_BODY } from "../../limits.ts";

const WebhookInput = z.union([
  z.string(),
  z.number(),
  z.record(z.string(), z.unknown()),
]);

const jsonEscape = {
  escape: (value: unknown) => JSON.stringify(String(value)).slice(1, -1),
};

export const webhookNode = defineNode({
  configSchema: WebhookConfig,
  execute: async (input, config, ctx) => {
    const parsed = WebhookInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("webhook expects a string, a number or an object");
    }
    const data = parsed.data;
    const params = typeof data === "object" ? data : { value: String(data) };

    const body = Mustache.render(config.bodyTemplate, params, {}, jsonEscape);
    if (body.length > MAX_WEBHOOK_BODY) {
      throw new Error(
        `webhook body is ${body.length} characters, over the ${MAX_WEBHOOK_BODY} limit`,
      );
    }

    await ctx.fetch({
      url: config.url,
      method: config.method,
      body: config.method === "POST" ? body : undefined,
    });

    return input;
  },
});
