import safeRegex from "safe-regex2";
import z from "zod";
import { templateError } from "@watchflow/security";
import {
  MAX_CONDITION_FIELD,
  MAX_CONDITION_VALUE,
  MAX_HEADER_NAME,
  MAX_HEADER_VALUE,
  MAX_HEADERS,
  MAX_JSONPATH,
  MAX_REGEX,
  MAX_REGEX_FLAGS,
  MAX_SELECTOR,
  MAX_TEMPLATE,
  MAX_URL,
} from "../limits.ts";

export const NUMERIC = /^-?\d+(\.\d+)?$/;

const safeTemplate = (min: number) =>
  z
    .string()
    .min(min)
    .max(MAX_TEMPLATE)
    .superRefine((value, ctx) => {
      const issue = templateError(value);
      if (issue) ctx.addIssue({ code: "custom", message: issue });
    });

const SafeUrl = z
  .string()
  .max(MAX_URL)
  .superRefine((value, ctx) => {
    if (/[\x00-\x1F\x7F]/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "URLs must not contain control characters",
      });
      return;
    }

    const url = URL.parse(value);
    if (!url) {
      ctx.addIssue({ code: "custom", message: "Not a valid URL" });
      return;
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      ctx.addIssue({
        code: "custom",
        message: "Only http and https URLs are allowed",
      });
    }
    if (url.username || url.password) {
      ctx.addIssue({
        code: "custom",
        message: "URLs must not contain credentials",
      });
    }
  });

const HeaderName = z
  .string()
  .min(1)
  .max(MAX_HEADER_NAME)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "Invalid header name");

const HeaderValue = z
  .string()
  .max(MAX_HEADER_VALUE)
  .regex(/^[\x20-\x7E]*$/, "Header values must be printable ASCII");

const FORBIDDEN_HEADERS = new Set([
  "host",
  "cookie",
  "content-length",
  "connection",
  "transfer-encoding",
]);

const Headers = z
  .record(HeaderName, HeaderValue)
  .refine(
    (h) => Object.keys(h).length <= MAX_HEADERS,
    `At most ${MAX_HEADERS} headers`,
  )
  .refine(
    (h) => !Object.keys(h).some((k) => FORBIDDEN_HEADERS.has(k.toLowerCase())),
    "This header may not be set",
  );

export const HttpFetchConfig = z
  .object({
    url: SafeUrl,
    headers: Headers.optional(),
    failOnError: z.boolean().default(true),
  })
  .strict();

export const CssSelectorConfig = z
  .object({ selector: z.string().min(1).max(MAX_SELECTOR) })
  .strict();

export const JsonPathConfig = z
  .object({ path: z.string().min(1).max(MAX_JSONPATH) })
  .strict();

export const RegexConfig = z
  .object({
    pattern: z.string().min(1).max(MAX_REGEX),
    flags: z.string().max(MAX_REGEX_FLAGS).optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    try {
      new RegExp(cfg.pattern, cfg.flags);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Not a valid regular expression",
        path: ["pattern"],
      });
      return;
    }
    if (!safeRegex(cfg.pattern.replace(/\(\?<[=!]/g, "(?:"))) {
      ctx.addIssue({
        code: "custom",
        message: "Pattern is vulnerable to catastrophic backtracking",
        path: ["pattern"],
      });
    }
  });

export const CompareLastConfig = z.object({}).strict();

export const ConditionConfig = z
  .object({
    field: z.string().min(1).max(MAX_CONDITION_FIELD).optional(),
    operator: z.enum(["equals", "not_equals", "contains", "gt", "lt"]),
    value: z.string().max(MAX_CONDITION_VALUE),
    valueType: z.enum(["string", "number"]).default("string"),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (
      (cfg.operator === "gt" || cfg.operator === "lt") &&
      cfg.valueType !== "number"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "gt and lt require valueType 'number'",
        path: ["operator"],
      });
    }
    if (cfg.valueType === "number" && !NUMERIC.test(cfg.value)) {
      ctx.addIssue({
        code: "custom",
        message: "value must be numeric",
        path: ["value"],
      });
    }
  });

export const EmailConfig = z
  .object({
    subject: safeTemplate(1),
    body: safeTemplate(1),
  })
  .strict();

export const WebhookConfig = z
  .object({
    url: SafeUrl,
    method: z.enum(["POST", "GET"]),
    bodyTemplate: safeTemplate(0),
  })
  .strict();
