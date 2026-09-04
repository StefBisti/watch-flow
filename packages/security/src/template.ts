import Mustache from "mustache";
import {
  MAX_RENDERED_OUTPUT,
  MAX_TEMPLATE_DEPTH,
  MAX_TEMPLATE_VALUE,
} from "./limits.ts";

/*
Mustache caches parsed templates in a module-level object keyed by the
template STRING. Every watch body a user saves would be a permanent entry:
an unbounded, attacker-sized map that no eviction ever touches.
 */
Mustache.templateCache = undefined;

/*
Token types Mustache emits, and why only two are allowed:

  "text"  literal template text, author-written        allowed
  "name"  {{value}} — interpolated, ESCAPED             allowed
  "&"     {{{value}}} / {{&value}} — interpolated RAW   banned: that is
          precisely the escape bypass this module exists to prevent
  "#" "^" sections/inverted sections                    banned: they invoke
          values as lambdas and can loop, which turns a template into a
          program over untrusted scraped data
  ">"     partials                                      banned: pulls in
          templates by name from outside this render

Enforced at save time (see templateError) so a bad template is rejected in
the editor, not at 3am in the worker.
 */
const ALLOWED_TOKENS = new Set(["text", "name"]);

/*
Returns a human-readable reason the template is unacceptable, or null if it
is fine. Used by the zod config schemas in @watchflow/flow.
 */
export function templateError(template: string): string | null {
  let tokens;
  try {
    tokens = Mustache.parse(template);
  } catch (e) {
    return e instanceof Error ? e.message : "invalid template";
  }
  for (const token of tokens) {
    if (!ALLOWED_TOKENS.has(token[0])) {
      return `unsupported template tag "${token[0]}" — only {{name}} is allowed`;
    }
  }
  return null;
}

/*
Where the rendered string is about to be used. There is no "raw" mode on
purpose: every sink gets an escaper, and adding a sink means adding one here.

  html  an email body                → HTML entity escaping
  text  an email subject, plain text → control characters stripped, because
        a CR/LF in a scraped value is SMTP header injection
  json  a webhook request body       → JSON string-literal escaping, and the
        whole result must parse as JSON before it is sent
 */
export type TemplateMode = "html" | "text" | "json";

const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

const escapers: Record<TemplateMode, (raw: string) => string> = {
  // Mustache's own escaper: & < > " ' ` = /
  html: Mustache.escape,
  text: (raw) => raw.replace(CONTROL_CHARS, " "),
  // JSON.stringify gives a quoted literal; the quotes belong to the template.
  json: (raw) => JSON.stringify(raw).slice(1, -1),
};

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") {
    try {
      s = JSON.stringify(value) ?? "";
    } catch {
      return ""; // circular
    }
  } else {
    s = String(value);
  }
  return s.length > MAX_TEMPLATE_VALUE ? s.slice(0, MAX_TEMPLATE_VALUE) : s;
}

/*
Mustache resolves a dotted name with `propName in obj`, and `in` walks the
prototype chain — so {{constructor}} on a plain object literal resolves, and
Mustache CALLS any function it resolves to. Rebuilding the view on a null
prototype removes the chain, and dropping functions removes lambda
invocation, so a tag can only ever reach data the previous node produced.

Arrays are rebuilt element by element rather than passed through: an array
handed back untouched keeps Array.prototype, and a function sitting in one is
still invoked as a lambda by {{arr.0}}. Functions become undefined instead of
being filtered out, because filtering would shift indices and silently point
{{arr.2}} at a different element.

Depth is capped because the view is JSON parsed from a watched site.
 */
function sanitize(value: unknown, depth: number): unknown {
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (Array.isArray(value)) {
    return depth >= MAX_TEMPLATE_DEPTH
      ? []
      : value.map((item) => sanitize(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return toView(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function toView(values: Record<string, unknown>, depth = 0): object {
  const out: Record<string, unknown> = Object.create(null);
  if (depth >= MAX_TEMPLATE_DEPTH) return out;
  for (const [key, value] of Object.entries(values)) {
    out[key] = sanitize(value, depth);
  }
  return out;
}

/*
Renders a user-authored template against untrusted values, escaped for the
sink it is headed to. Throws rather than emitting anything it cannot vouch
for — a notification that does not go out is recoverable, an injected one is
not.
 */
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
  mode: TemplateMode,
): string {
  const issue = templateError(template);
  if (issue) throw new Error(`template rejected: ${issue}`);

  const escape = escapers[mode];
  const rendered = Mustache.render(
    template,
    toView(values),
    {},
    {
      escape: (value: unknown) => escape(stringify(value)),
    },
  );

  if (rendered.length > MAX_RENDERED_OUTPUT) {
    throw new Error(
      `rendered template is ${rendered.length} characters, over the ${MAX_RENDERED_OUTPUT} limit`,
    );
  }

  /*
  The escaper only guarantees each VALUE is a well-formed JSON string body.
  The literal text around the tags is author-written and can still be broken
  JSON ({"n": {{value}}} with a non-numeric value, a missing brace). Sending
  that with content-type: application/json is a bug at best and a request
  smuggled past the receiver's parser at worst, so verify the whole thing.
   */
  if (mode === "json" && rendered.trim() !== "") {
    try {
      JSON.parse(rendered);
    } catch {
      throw new Error("rendered template is not valid JSON");
    }
  }

  return rendered;
}
