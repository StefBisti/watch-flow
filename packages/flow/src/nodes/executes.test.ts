import { expect, test, vi } from "vitest";
import type { FetchResponse, EmailMessage, RegexMatch } from "../io.ts";
import { httpFetchNode } from "./execute/http-fetch.ts";
import { cssSelectorNode } from "./execute/css-selector.ts";
import { jsonPathNode } from "./execute/json-path.ts";
import { regexNode } from "./execute/regex.ts";
import { conditionNode } from "./execute/condition.ts";
import { emailNode } from "./execute/email.ts";
import { webhookNode } from "./execute/webhook.ts";
import { compareLastNode } from "./execute/compare-last.ts";
import {
  MAX_NODE_OUTPUT,
  MAX_REGEX_INPUT,
  MAX_WEBHOOK_BODY,
} from "../limits.ts";
import type { NodeContext } from "./context.ts";

const response = (over: Partial<FetchResponse> = {}): FetchResponse => ({
  status: 200,
  headers: {},
  body: "",
  truncated: false,
  ...over,
});

const ctx = (over: Partial<NodeContext> = {}): NodeContext => ({
  fetch: vi.fn(async () => response()),
  sendEmail: vi.fn(async () => {}),
  matchRegex: async ({ text, pattern, flags }) =>
    new RegExp(pattern, flags).exec(text) as RegexMatch | null,
  previous: null,
  saveSnapshot: vi.fn(async () => {}),
  signal: AbortSignal.timeout(5_000),
  now: () => new Date("2026-01-01T00:00:00Z"),
  ...over,
});

/* ------------------------------------------------------------ http_fetch --- */

test("http_fetch returns status, body and the truncation flag", async () => {
  const c = ctx({
    fetch: async () => response({ body: "hi", truncated: true }),
  });
  expect(
    await httpFetchNode.execute(
      null,
      { url: "https://a.test", failOnError: true },
      c,
    ),
  ).toEqual({ status: 200, body: "hi", truncated: true });
});

test("http_fetch throws on a non-2xx by default", async () => {
  const c = ctx({
    fetch: async () => response({ status: 404, body: "<h1>gone" }),
  });
  await expect(
    httpFetchNode.execute(
      null,
      { url: "https://a.test", failOnError: true },
      c,
    ),
  ).rejects.toThrow(/404/);
});

test("http_fetch keeps the status when failOnError is off", async () => {
  const c = ctx({ fetch: async () => response({ status: 503 }) });
  const out = await httpFetchNode.execute(
    null,
    { url: "https://a.test", failOnError: false },
    c,
  );
  expect(out).toMatchObject({ status: 503 });
});

test("🔒 http_fetch does not put the full url in the error", async () => {
  const c = ctx({ fetch: async () => response({ status: 500 }) });
  await expect(
    httpFetchNode.execute(
      null,
      { url: "https://a.test/x?token=SECRET", failOnError: true },
      c,
    ),
  ).rejects.toThrow(/^(?!.*SECRET).*$/);
});

test("http_fetch forwards configured headers", async () => {
  const fetch = vi.fn(async () => response());
  await httpFetchNode.execute(
    null,
    { url: "https://a.test", headers: { "X-Api": "k" }, failOnError: true },
    ctx({ fetch }),
  );
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({ headers: { "X-Api": "k" }, method: "GET" }),
  );
});

/* ---------------------------------------------------------- css_selector --- */

test("css_selector extracts the first match as trimmed text", async () => {
  const html = "<div class='p'> 29.99 </div><div class='p'>34.99</div>";
  expect(await cssSelectorNode.execute(html, { selector: ".p" }, ctx())).toBe(
    "29.99",
  );
});

test("css_selector accepts the { body } shape from http_fetch", async () => {
  expect(
    await cssSelectorNode.execute(
      { body: "<b>x</b>" },
      { selector: "b" },
      ctx(),
    ),
  ).toBe("x");
});

test("css_selector returns null when nothing matches", async () => {
  expect(
    await cssSelectorNode.execute("<p>a</p>", { selector: ".none" }, ctx()),
  ).toBeNull();
});

test("🔒 css_selector truncates its output", async () => {
  const html = `<p>${"a".repeat(MAX_NODE_OUTPUT + 500)}</p>`;
  const out = await cssSelectorNode.execute(html, { selector: "p" }, ctx());
  expect(String(out)).toHaveLength(MAX_NODE_OUTPUT);
});

test("css_selector rejects a non-text input", async () => {
  await expect(
    cssSelectorNode.execute(42, { selector: "p" }, ctx()),
  ).rejects.toThrow(/expects HTML/);
});

/* ------------------------------------------------------------- json_path --- */

test("json_path extracts a scalar", async () => {
  expect(
    await jsonPathNode.execute('{"price":"29.99"}', { path: "$.price" }, ctx()),
  ).toBe("29.99");
});

test("json_path serialises an object match", async () => {
  expect(
    await jsonPathNode.execute('{"a":{"b":1}}', { path: "$.a" }, ctx()),
  ).toBe('{"b":1}');
});

test("json_path returns null when nothing matches", async () => {
  expect(
    await jsonPathNode.execute('{"a":1}', { path: "$.nope" }, ctx()),
  ).toBeNull();
});

test("json_path rejects input that is not JSON", async () => {
  await expect(
    jsonPathNode.execute("<html>", { path: "$.a" }, ctx()),
  ).rejects.toThrow(/not valid JSON/);
});

test("🔒 json_path refuses filter expressions (eval is disabled)", async () => {
  await expect(
    jsonPathNode.execute('[{"x":1}]', { path: "$[?(@.x==1)]" }, ctx()),
  ).rejects.toThrow(/could not evaluate/);
});

/* ----------------------------------------------------------------- regex --- */

test("regex returns the first capture group when there is one", async () => {
  expect(
    await regexNode.execute(
      "Only 3 left",
      { pattern: "Only (\\d+) left" },
      ctx(),
    ),
  ).toBe("3");
});

test("regex returns the whole match when there is no group", async () => {
  expect(await regexNode.execute("abc123", { pattern: "\\d+" }, ctx())).toBe(
    "123",
  );
});

test("regex returns null when nothing matches", async () => {
  expect(await regexNode.execute("abc", { pattern: "\\d+" }, ctx())).toBeNull();
});

test("regex honours flags", async () => {
  expect(
    await regexNode.execute("ABC", { pattern: "abc", flags: "i" }, ctx()),
  ).toBe("ABC");
});

test("🔒 regex only sees the first MAX_REGEX_INPUT characters", async () => {
  const text = "a".repeat(MAX_REGEX_INPUT) + "NEEDLE";
  expect(
    await regexNode.execute(text, { pattern: "NEEDLE" }, ctx()),
  ).toBeNull();
});

/* ------------------------------------------------------------- condition --- */

const cond = (over: Record<string, unknown>) =>
  ({ operator: "equals", value: "x", valueType: "string", ...over }) as never;

test("condition compares a scalar when no field is set", async () => {
  expect(
    await conditionNode.execute("29.99", cond({ value: "29.99" }), ctx()),
  ).toBe(true);
});

test("condition reads the named field off an object", async () => {
  const input = { changed: true, value: "1", previous: null };
  expect(
    await conditionNode.execute(
      input,
      cond({ field: "changed", value: "true" }),
      ctx(),
    ),
  ).toBe(true);
});

test("condition throws when the field is absent", async () => {
  await expect(
    conditionNode.execute({ a: 1 }, cond({ field: "missing" }), ctx()),
  ).rejects.toThrow(/no field/);
});

test("🔒 condition does not resolve prototype keys", async () => {
  await expect(
    conditionNode.execute({ a: 1 }, cond({ field: "__proto__" }), ctx()),
  ).rejects.toThrow(/no field/);
});

test("condition compares numbers with gt", async () => {
  const c = cond({ operator: "gt", value: "30", valueType: "number" });
  expect(await conditionNode.execute("31.5", c, ctx())).toBe(true);
  expect(await conditionNode.execute("29", c, ctx())).toBe(false);
});

test("🔒 condition rejects sloppy numeric input", async () => {
  const c = cond({ operator: "gt", value: "30", valueType: "number" });
  for (const bad of ["0x10", " 12 ", "", "1e999"]) {
    await expect(conditionNode.execute(bad, c, ctx())).rejects.toThrow(
      /not a number/,
    );
  }
});

test("condition contains works on a stringified value", async () => {
  expect(
    await conditionNode.execute(
      "on sale now",
      cond({ operator: "contains", value: "sale" }),
      ctx(),
    ),
  ).toBe(true);
});

/* ----------------------------------------------------------------- email --- */

test("email renders both templates and sends", async () => {
  const sendEmail = vi.fn(async () => {});
  await emailNode.execute(
    "29.99",
    { subject: "Now {{value}}", body: "<p>{{value}}</p>" },
    ctx({ sendEmail }),
  );
  expect(sendEmail).toHaveBeenCalledWith({
    subject: "Now 29.99",
    html: "<p>29.99</p>",
  });
});

test("🔒 email escapes HTML in the body but not the subject", async () => {
  const sendEmail = vi.fn(async () => {});
  await emailNode.execute(
    "a & <b>",
    { subject: "{{value}}", body: "{{value}}" },
    ctx({ sendEmail }),
  );
  expect(sendEmail).toHaveBeenCalledWith({
    subject: "a & <b>",
    html: "a &amp; &lt;b&gt;",
  });
});

test("🔒 email strips CR/LF from the subject (header injection)", async () => {
  let sent: EmailMessage | undefined;
  const c = ctx({
    sendEmail: async (msg) => {
      sent = msg;
    },
  });
  await emailNode.execute(
    "x\r\nBcc: evil@test",
    { subject: "{{value}}", body: "b" },
    c,
  );
  expect(sent?.subject).not.toMatch(/[\r\n]/);
});

test("email falls back when the subject renders empty", async () => {
  let sent: EmailMessage | undefined;
  const c = ctx({
    sendEmail: async (msg) => {
      sent = msg;
    },
  });
  await emailNode.execute("v", { subject: "{{typo}}", body: "b" }, c);
  expect(sent?.subject).toBe("WatchFlow alert");
});

test("🔒 webhook JSON-escapes interpolated values", async () => {
  let sentBody: string | undefined;
  const c = ctx({
    fetch: async (req) => {
      sentBody = req.body;
      return response();
    },
  });
  const evil = 'hi", "admin": true, "x": "';
  await webhookNode.execute(
    evil,
    {
      url: "https://a.test/h",
      method: "POST",
      bodyTemplate: '{"text":"{{value}}"}',
    },
    c,
  );
  expect(JSON.parse(sentBody!)).toEqual({ text: evil });
});

test("webhook refuses an oversized rendered body", async () => {
  await expect(
    webhookNode.execute(
      "a".repeat(MAX_WEBHOOK_BODY + 1),
      { url: "https://a.test/h", method: "POST", bodyTemplate: "{{value}}" },
      ctx(),
    ),
  ).rejects.toThrow(/over the/);
});

/* ---------------------------------------------------------- compare_last --- */

test("compare_last reports no change on the first run", async () => {
  const saveSnapshot = vi.fn(async () => {});
  const out = await compareLastNode.execute(
    "29.99",
    {},
    ctx({ previous: null, saveSnapshot }),
  );
  expect(out).toEqual({ changed: false, value: "29.99", previous: null });
  expect(saveSnapshot).toHaveBeenCalledWith("29.99");
});

test("compare_last detects a change and keeps the old value", async () => {
  const out = await compareLastNode.execute(
    "29.99",
    {},
    ctx({ previous: "34.99" }),
  );
  expect(out).toEqual({ changed: true, value: "29.99", previous: "34.99" });
});

test("compare_last reports no change when the value is identical", async () => {
  const out = await compareLastNode.execute(
    "29.99",
    {},
    ctx({ previous: "29.99" }),
  );
  expect(out).toMatchObject({ changed: false });
});
