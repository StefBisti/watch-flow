import z from "zod";
import { EmailConfig } from "../config.ts";
import { defineNode } from "../definition.ts";
import { renderTemplate } from "@watchflow/security";
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

    const subject =
      renderTemplate(config.subject, params, "text")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_EMAIL_SUBJECT) || "WatchFlow alert";

    const html = renderTemplate(config.body, params, "html")
      .trim()
      .slice(0, MAX_EMAIL_BODY);

    await ctx.sendEmail({ subject, html });
    return input;
  },
});
