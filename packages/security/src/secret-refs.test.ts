import { expect, test } from "vitest";
import { redact } from "./redact.ts";
import { resolveSecretRefs } from "./secret-refs.ts";

const secrets = { API_TOKEN: "tok_live_123", DOLLAR: "abc$&def" };

test("replaces refs inside header values", () => {
  expect(
    resolveSecretRefs(
      { authorization: "Bearer {{secret.API_TOKEN}}" },
      secrets,
    ),
  ).toEqual({ authorization: "Bearer tok_live_123" });
});

test("replaces several refs in one value", () => {
  expect(
    resolveSecretRefs(
      { x: "{{secret.API_TOKEN}}:{{secret.API_TOKEN}}" },
      secrets,
    ),
  ).toEqual({ x: "tok_live_123:tok_live_123" });
});

test("does not expand $ patterns inside secret values", () => {
  expect(resolveSecretRefs({ x: "{{secret.DOLLAR}}" }, secrets)).toEqual({
    x: "abc$&def",
  });
});

test("throws on an unknown secret name", () => {
  expect(() => resolveSecretRefs({ x: "{{secret.MISSING}}" }, secrets)).toThrow(
    "unknown secret MISSING",
  );
});

test("leaves undefined and ref-free headers untouched", () => {
  expect(resolveSecretRefs(undefined, secrets)).toBeUndefined();
  expect(resolveSecretRefs({ accept: "text/html" }, secrets)).toEqual({
    accept: "text/html",
  });
});

test("a resolved secret echoed back into a run log is redacted", () => {
  const headers = resolveSecretRefs(
    { authorization: "Bearer {{secret.API_TOKEN}}" },
    secrets,
  );
  // httpbin-style echo: the target returns our headers in its JSON body,
  // and the engine stringifies the node output again for the log preview
  const log = [
    {
      nodeId: "fetch",
      status: "ok",
      output: JSON.stringify({ body: JSON.stringify({ headers }) }),
    },
  ];
  expect(JSON.stringify(redact(log, Object.values(secrets)))).not.toContain(
    "tok_live_123",
  );
});
