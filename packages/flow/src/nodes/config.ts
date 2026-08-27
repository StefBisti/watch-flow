import safeRegex from "safe-regex2";
import z from "zod";
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

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host.startsWith("[")) {
    const ip = host.slice(1, -1);
    if (ip === "::1" || ip === "::") return true;
    if (/^f[cd]/.test(ip)) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (mapped) {
      const n = (parseInt(mapped[1]!, 16) << 16) | parseInt(mapped[2]!, 16);
      return isBlockedIPv4([
        n >>> 24,
        (n >>> 16) & 255,
        (n >>> 8) & 255,
        n & 255,
      ]);
    }
    return false;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isBlockedIPv4(v4.slice(1).map(Number));

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return host.endsWith(".local") || host.endsWith(".internal");
}

function isBlockedIPv4([a, b]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8   "this network"
    a === 10 || // 10/8        private
    a === 127 || // 127/8       loopback
    (a === 100 && b! >= 64 && b! <= 127) || // 100.64/10  carrier NAT
    (a === 169 && b === 254) || // 169.254/16  link-local, incl. cloud metadata
    (a === 172 && b! >= 16 && b! <= 31) || // 172.16/12  private
    (a === 192 && b === 168) // 192.168/16  private
  );
}

const SafeUrl = z
  // The protocol is checked below rather than via z.url({ protocol }), whose
  // failure message is "Invalid URL" — misleading for a well-formed file:// URL.
  .url()
  .max(MAX_URL)
  .superRefine((value, ctx) => {
    const url = new URL(value);
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
    if (isBlockedHost(url.hostname)) {
      ctx.addIssue({
        code: "custom",
        message: "URLs must not point at private/loopback addresses",
      });
    }
  });

// RFC 7230 token charset. Anything outside it (CR, LF, colon, space) is header injection.

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
  .object({ url: SafeUrl, headers: Headers.optional() })
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
    if (!safeRegex(cfg.pattern)) {
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
    field: z.string().min(1).max(MAX_CONDITION_FIELD),
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
    if (cfg.valueType === "number" && Number.isNaN(Number(cfg.value))) {
      ctx.addIssue({
        code: "custom",
        message: "value must be numeric",
        path: ["value"],
      });
    }
  });

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
