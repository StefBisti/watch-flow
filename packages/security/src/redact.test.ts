import { expect, test } from "vitest";
import { redact } from "./redact.ts";

test("replaces values under sensitive keys, case-insensitively", () => {
  const input = {
    Authorization: "Bearer abc123",
    "x-api-key": "k-999",
    Cookie: "session=1",
    password: "hunter2",
    refreshToken: "tok",
    plain: "keep me",
  };
  expect(redact(input)).toEqual({
    Authorization: "[REDACTED]",
    "x-api-key": "[REDACTED]",
    Cookie: "[REDACTED]",
    password: "[REDACTED]",
    refreshToken: "[REDACTED]",
    plain: "keep me",
  });
});

test("redacts sensitive keys at any nesting depth, and inside arrays", () => {
  const input = {
    log: [
      { nodeId: "fetch", output: { headers: { authorization: "Bearer x" } } },
      { nodeId: "mail", output: "ok" },
    ],
  };
  const out = redact(input) as {
    log: [
      { output: { headers: { authorization: string } } },
      { output: string },
    ];
  };
  expect(out.log[0].output.headers.authorization).toBe("[REDACTED]");
  expect(out.log[1].output).toBe("ok");
});

test("scrubs known secret VALUES embedded inside strings", () => {
  const out = redact({ output: "rendered body: token=s3cr3t-value&x=1" }, [
    "s3cr3t-value",
  ]);
  expect(out).toEqual({ output: "rendered body: token=[REDACTED]&x=1" });
});

test("ignores secret values too short to search for", () => {
  // redacting every "a" would destroy the log — short values are skipped
  expect(redact({ note: "a plain sentence" }, ["a", ""])).toEqual({
    note: "a plain sentence",
  });
});

test("does not mutate the input", () => {
  const input = { authorization: "Bearer x", nested: { token: "t" } };
  redact(input);
  expect(input.authorization).toBe("Bearer x");
  expect(input.nested.token).toBe("t");
});

test("passes primitives and dates through untouched", () => {
  const when = new Date("2026-01-01T00:00:00Z");
  expect(redact(42)).toBe(42);
  expect(redact(null)).toBeNull();
  expect(redact(true)).toBe(true);
  expect(redact(when)).toBe(when);
});

test("never throws on circular structures", () => {
  const input: Record<string, unknown> = { name: "loop" };
  input["self"] = input;
  expect(redact(input)).toEqual({ name: "loop", self: "[CIRCULAR]" });
});

test("over-redacts rather than under-redacts on ambiguous keys", () => {
  // "monkey" contains "key" — fail closed is the documented behaviour
  expect(redact({ monkey: "bananas" })).toEqual({ monkey: "[REDACTED]" });
});

test("🔒 overlapping secrets: the longest is redacted first", () => {
  const out = redact({ output: "token=hunter2extra" }, [
    "hunter2",
    "hunter2extra",
  ]);
  expect(out).toEqual({ output: "token=[REDACTED]" });
});

test("a shared (non-circular) reference is walked twice, not dropped", () => {
  const shared = { nodeId: "fetch", status: 200 };
  expect(redact({ first: shared, second: shared })).toEqual({
    first: { nodeId: "fetch", status: 200 },
    second: { nodeId: "fetch", status: 200 },
  });
});

test("🔒 an Error keeps its message and stack instead of scrubbing to {}", () => {
  const out = redact(new Error("boom with hunter2"), ["hunter2"]) as {
    name: string;
    message: string;
    stack: string;
  };
  expect(out.name).toBe("Error");
  expect(out.message).toBe("boom with [REDACTED]");
  expect(out.stack).toContain("[REDACTED]");
  expect(out.stack).not.toContain("hunter2");
});

test("Map and Set become plain data rather than {}", () => {
  expect(redact({ m: new Map([["a", 1]]), s: new Set([1, 2]) })).toEqual({
    m: { a: 1 },
    s: [1, 2],
  });
});

test("a Map with non-string keys keeps every entry as a pair", () => {
  // Object.fromEntries would coerce both keys to "[object Object]"
  const m = new Map<object, string>([
    [{ id: 1 }, "x"],
    [{ id: 2 }, "y"],
  ]);
  expect(redact({ m })).toEqual({
    m: [
      [{ id: 1 }, "x"],
      [{ id: 2 }, "y"],
    ],
  });
});

test("🔒 a secret used as a KEY name is redacted too", () => {
  expect(redact({ "s3cr3t-value": "count" }, ["s3cr3t-value"])).toEqual({
    "[REDACTED]": "count",
  });
});

test("🔒 an Error keeps its own enumerable properties too", () => {
  const err = Object.assign(new Error("connect failed"), {
    code: "ECONNREFUSED",
    statusCode: 503,
  });
  expect(redact(err)).toMatchObject({
    name: "Error",
    message: "connect failed",
    code: "ECONNREFUSED",
    statusCode: 503,
  });
});

test("🔒 a __proto__ key is kept as data, not swallowed by the setter", () => {
  const input = JSON.parse('{"__proto__":{"polluted":1},"a":2}') as object;
  const out = redact(input) as Record<string, unknown>;
  expect(Object.hasOwn(out, "__proto__")).toBe(true);
  expect(out["a"]).toBe(2);
  expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
});

test("two keys that scrub to the same name both survive", () => {
  const out = redact({ "a-hunter2": "first", "a-hunter2extra": "second" }, [
    "hunter2",
    "hunter2extra",
  ]) as Record<string, unknown>;
  expect(Object.values(out).sort()).toEqual(["first", "second"]);
});

test("a shared subtree is not re-walked exponentially", () => {
  // 25 levels of two-way sharing: 2^25 walks without the memo.
  let node: unknown = { leaf: 1 };
  for (let i = 0; i < 25; i++) node = { a: node, b: node };
  const started = Date.now();
  redact(node);
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("caps runaway nesting instead of blowing the stack", () => {
  let deep: unknown = "bottom";
  for (let i = 0; i < 5_000; i++) deep = [deep];
  expect(() => redact(deep)).not.toThrow();
  expect(JSON.stringify(redact(deep))).toContain("[TRUNCATED]");
});
