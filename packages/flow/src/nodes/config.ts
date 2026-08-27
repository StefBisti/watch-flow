import z from "zod";
import { MAX_REGEX, MAX_SELECTOR, MAX_TEMPLATE, MAX_URL } from "../limits.ts";

const SafeUrl = z
  .url()
  .max(MAX_URL)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Only http and https URLs are allowed");

export const HttpFetchConfig = z
  .object({
    url: SafeUrl,
    headers: z
      .record(z.string().max(100), z.string().max(1000))
      .refine((h) => Object.keys(h).length <= 20, "Too many headers")
      .optional(),
  })
  .strict();

export const CssSelectorConfig = z
  .object({
    selector: z.string().min(1).max(MAX_SELECTOR),
  })
  .strict();

export const JsonPathConfig = z
  .object({
    path: z.string().min(1).max(MAX_SELECTOR),
  })
  .strict();

export const RegexConfig = z
  .object({
    pattern: z.string().min(1).max(MAX_REGEX),
    flags: z
      .string()
      .max(8)
      .regex(/^[gimsuy]*$/)
      .optional(),
  })
  .strict();

export const CompareLastConfig = z.object({}).strict();

export const ConditionConfig = z
  .object({
    field: z.string().min(1).max(100),
    operator: z.enum(["equals", "not_equals", "contains", "gt", "lt"]),
    value: z.string().max(500),
  })
  .strict();

export const EmailConfig = z
  .object({
    subject: z.string().min(1).max(MAX_TEMPLATE),
    body: z.string().min(1).max(MAX_TEMPLATE),
  })
  .strict();

export const WebhookConfig = z
  .object({
    url: SafeUrl,
    method: z.enum(["POST", "GET"]),
    bodyTemplate: z.string().max(MAX_TEMPLATE),
  })
  .strict();
