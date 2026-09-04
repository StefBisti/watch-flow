import { describe, expect, it } from "vitest";
import { renderTemplate, templateError } from "./template.ts";
import { MAX_RENDERED_OUTPUT, MAX_TEMPLATE_VALUE } from "./limits.ts";

describe("templateError", () => {
  it("accepts literal text and escaped interpolation", () => {
    expect(templateError("Price is now {{value}}")).toBeNull();
  });

  it("accepts dotted lookups", () => {
    expect(templateError("{{secret.apiKey}}")).toBeNull();
  });

  it("rejects triple-stache raw output", () => {
    expect(templateError("{{{value}}}")).toMatch(/unsupported template tag/);
  });

  it("rejects the ampersand form of raw output", () => {
    expect(templateError("{{& value}}")).toMatch(/unsupported template tag/);
  });

  it("rejects sections", () => {
    expect(templateError("{{#items}}x{{/items}}")).toMatch(
      /unsupported template tag/,
    );
  });

  it("rejects inverted sections", () => {
    expect(templateError("{{^items}}x{{/items}}")).toMatch(
      /unsupported template tag/,
    );
  });

  it("rejects partials", () => {
    expect(templateError("{{> header}}")).toMatch(/unsupported template tag/);
  });

  it("reports unclosed tags instead of throwing", () => {
    expect(templateError("{{value")).toEqual(expect.any(String));
  });
});

describe("renderTemplate — html", () => {
  it("escapes HTML in interpolated values", () => {
    const out = renderTemplate("<p>{{v}}</p>", { v: "<img onerror=x>" }, "html");
    expect(out).toBe("<p>&lt;img onerror&#x3D;x&gt;</p>");
  });

  it("escapes quotes and backticks so a value cannot break an attribute", () => {
    const out = renderTemplate("{{v}}", { v: "\"'`" }, "html");
    expect(out).not.toMatch(/["'`]/);
  });

  it("leaves author-written literal text alone", () => {
    expect(renderTemplate("<b>hi</b>", {}, "html")).toBe("<b>hi</b>");
  });

  it("renders a missing key as empty rather than throwing", () => {
    expect(renderTemplate("[{{nope}}]", {}, "html")).toBe("[]");
  });
});

describe("renderTemplate — object values", () => {
  // toView rebuilds nested objects on a null prototype, which has no
  // toString, so String() on one throws. A json_path node returning an object
  // into {{value}} is ordinary input and must not kill the node.
  it("renders an object value instead of throwing", () => {
    expect(renderTemplate("{{a}}", { a: { b: 1 } }, "text")).toBe('{"b":1}');
  });

  it("renders an array value instead of throwing", () => {
    expect(renderTemplate("{{a}}", { a: [1, 2] }, "text")).toBe("[1,2]");
  });

  it("escapes a rendered object for its sink", () => {
    const out = renderTemplate('{"m":"{{a}}"}', { a: { b: "x" } }, "json");
    expect(JSON.parse(out)).toEqual({ m: '{"b":"x"}' });
  });

  // The depth cap in toView severs the cycle before JSON.stringify sees it,
  // so a circular value renders truncated rather than throwing.
  it("renders a circular value truncated rather than throwing", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const out = renderTemplate("{{a}}", { a }, "text");
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toContain('"self"');
  });
});

describe("renderTemplate — text", () => {
  it("strips CR and LF so a value cannot inject an email header", () => {
    const out = renderTemplate(
      "{{v}}",
      { v: "ok\r\nBcc: attacker@evil.test" },
      "text",
    );
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toBe("ok  Bcc: attacker@evil.test");
  });

  it("strips NUL and other control characters", () => {
    expect(renderTemplate("{{v}}", { v: "a\x00b\x1Bc\x7Fd" }, "text")).toBe(
      "a b c d",
    );
  });

  it("does not HTML-escape, because the sink is plain text", () => {
    expect(renderTemplate("{{v}}", { v: "a & b < c" }, "text")).toBe(
      "a & b < c",
    );
  });
});

describe("renderTemplate — json", () => {
  it("escapes quotes so a value cannot break out of its string", () => {
    const out = renderTemplate(
      '{"m":"{{v}}"}',
      { v: '","admin":true,"x":"' },
      "json",
    );
    expect(JSON.parse(out)).toEqual({ m: '","admin":true,"x":"' });
  });

  it("escapes newlines and control characters", () => {
    const out = renderTemplate('{"m":"{{v}}"}', { v: "a\nb\tc" }, "json");
    expect(JSON.parse(out)).toEqual({ m: "a\nb\tc" });
  });

  it("escapes backslashes", () => {
    const out = renderTemplate('{"m":"{{v}}"}', { v: 'a\\"b' }, "json");
    expect(JSON.parse(out)).toEqual({ m: 'a\\"b' });
  });

  it("rejects a template whose literal text renders to invalid JSON", () => {
    expect(() =>
      renderTemplate('{"n": {{v}}}', { v: "not-a-number" }, "json"),
    ).toThrow(/not valid JSON/);
  });

  it("allows an empty body", () => {
    expect(renderTemplate("", {}, "json")).toBe("");
  });
});

describe("renderTemplate — view hardening", () => {
  it("does not resolve inherited prototype properties", () => {
    expect(renderTemplate("[{{constructor}}]", { a: 1 }, "text")).toBe("[]");
    expect(renderTemplate("[{{__proto__}}]", { a: 1 }, "text")).toBe("[]");
    expect(renderTemplate("[{{toString}}]", { a: 1 }, "text")).toBe("[]");
  });

  it("does not resolve prototype properties on nested values", () => {
    expect(
      renderTemplate("[{{a.constructor}}]", { a: { b: 1 } }, "text"),
    ).toBe("[]");
  });

  it("never invokes a value as a lambda", () => {
    const values = { f: () => "CALLED" } as unknown as Record<string, unknown>;
    expect(renderTemplate("[{{f}}]", values, "text")).toBe("[]");
  });

  it("never invokes a value sitting inside an array", () => {
    const values = { arr: [() => "CALLED"] } as unknown as Record<
      string,
      unknown
    >;
    expect(renderTemplate("[{{arr.0}}]", values, "text")).toBe("[]");
  });

  it("keeps array indices stable when an element is dropped", () => {
    const values = { arr: [() => "CALLED", "second"] } as unknown as Record<
      string,
      unknown
    >;
    expect(renderTemplate("[{{arr.1}}]", values, "text")).toBe("[second]");
  });

  it("still resolves real nested data", () => {
    expect(
      renderTemplate("{{a.b.c}}", { a: { b: { c: "deep" } } }, "text"),
    ).toBe("deep");
  });

  it("does not mutate the values it is given", () => {
    const values = { a: { b: 1 } };
    renderTemplate("{{a.b}}", values, "text");
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
  });
});

describe("renderTemplate — caps", () => {
  it("truncates a single value to MAX_TEMPLATE_VALUE", () => {
    const out = renderTemplate("{{v}}", { v: "a".repeat(50_000) }, "text");
    expect(out).toHaveLength(MAX_TEMPLATE_VALUE);
  });

  it("rejects a scraped body sprayed across many tags", () => {
    const template = "{{v}}".repeat(400);
    expect(() =>
      renderTemplate(template, { v: "a".repeat(2_000_000) }, "text"),
    ).toThrow(/over the/);
  });

  it("throws when literal template text alone exceeds the output cap", () => {
    expect(() =>
      renderTemplate("a".repeat(MAX_RENDERED_OUTPUT + 1), {}, "text"),
    ).toThrow(/over the/);
  });

  it("refuses to render a template it would have rejected at save time", () => {
    expect(() => renderTemplate("{{{v}}}", { v: "<b>" }, "html")).toThrow(
      /template rejected/,
    );
  });
});
