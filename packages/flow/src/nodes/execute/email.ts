import z from "zod";
import { EmailConfig } from "../config.ts";
import { defineNode } from "../registry.ts";
import Mustache from "mustache";
import { MAX_EMAIL_BODY, MAX_EMAIL_SUBJECT } from "../../limits.ts";

const EmailInput = z.union([
  z.string(),
  z.number(),
  z.record(z.string(), z.unknown()),
]);

export const emailNode = defineNode({
  configSchema: EmailConfig,
  execute: async (input, config, ctx) => {
    const parsed = EmailInput.safeParse(input);
    if (!parsed.success) {
      throw new Error("email expects a string, a number or an object");
    }
    const data = parsed.data;
    const params = typeof data === "object" ? data : { value: String(data) };

    const subject = Mustache.render(
      config.subject,
      params,
      {},
      { escape: (value: unknown) => String(value) },
    )
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, MAX_EMAIL_SUBJECT);

    const html = Mustache.render(config.body, params)
      .trim()
      .slice(0, MAX_EMAIL_BODY);

    await ctx.sendEmail({ subject, html });
    return input;
  },
});
