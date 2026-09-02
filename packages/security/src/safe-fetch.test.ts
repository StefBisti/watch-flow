import { afterAll, expect, test, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { createSafeFetch, type SafeFetchOptions } from "./safe-fetch.ts";
import { MAX_REDIRECTS, MAX_RESPONSE_BYTES } from "./limits.ts";

/* Test policy: approves everything, pins every hostname to loopback. */
const allowAll: NonNullable<SafeFetchOptions["policy"]> = async (raw) => ({
  ok: true,
  url: new URL(raw),
  ips: ["127.0.0.1"],
});

const noResolver = async () => {
  throw new Error("resolver must not be called in these tests");
};

const servers: Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));

const listen = (handler: Parameters<typeof createServer>[1]): Promise<number> =>
  new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
  });

const fetchWith = (over: SafeFetchOptions = {}) =>
  createSafeFetch({ policy: allowAll, resolver: noResolver, ...over });

/* -------------------------------------------------------------- pinning --- */

test("🔒 connects to the pinned IP, not DNS, while keeping the Host header", async () => {
  let seenHost = "";
  const port = await listen((req, res) => {
    seenHost = req.headers.host ?? "";
    res.end("pinned");
  });
  // watch.test does not resolve anywhere — reaching the server at all
  // proves the connection used the policy's IPs.
  const res = await fetchWith()({
    url: `http://watch.test:${port}/`,
    method: "GET",
  });
  expect(res.body).toBe("pinned");
  expect(seenHost).toBe(`watch.test:${port}`);
});

/* -------------------------------------------------------------- headers --- */

test("🔒 strips set-cookie from responses and cookie from requests", async () => {
  let seenCookie: string | undefined = "unset";
  const port = await listen((req, res) => {
    seenCookie = req.headers.cookie;
    res.setHeader("set-cookie", "session=abc");
    res.setHeader("x-kept", "yes");
    res.end("ok");
  });
  const res = await fetchWith()({
    url: `http://watch.test:${port}/`,
    method: "GET",
    headers: { Cookie: "stolen=1", "X-Api-Key": "k" },
  });
  expect(seenCookie).toBeUndefined();
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.headers["x-kept"]).toBe("yes");
});

/* ----------------------------------------------------------------- caps --- */

test("🔒 truncates a body past MAX_RESPONSE_BYTES", async () => {
  const port = await listen((_req, res) => {
    res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 50_000, "a"));
  });
  const res = await fetchWith()({
    url: `http://watch.test:${port}/`,
    method: "GET",
  });
  expect(res.truncated).toBe(true);
  expect(res.body.length).toBe(MAX_RESPONSE_BYTES);
});

test("🔒 the cap applies to DECOMPRESSED bytes (gzip bomb)", async () => {
  const bomb = gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES * 3)); // tiny on the wire
  const port = await listen((_req, res) => {
    res.setHeader("content-encoding", "gzip");
    res.end(bomb);
  });
  const res = await fetchWith()({
    url: `http://watch.test:${port}/`,
    method: "GET",
  });
  expect(res.truncated).toBe(true);
  expect(res.body.length).toBe(MAX_RESPONSE_BYTES);
});

/* ------------------------------------------------------------- redirects --- */

test("🔒 re-validates every redirect hop through the policy", async () => {
  const port = await listen((req, res) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: "/end" });
      res.end();
    } else res.end("done");
  });
  const policy = vi.fn(allowAll);
  const res = await fetchWith({ policy })({
    url: `http://watch.test:${port}/start`,
    method: "GET",
  });
  expect(res.body).toBe("done");
  expect(policy).toHaveBeenCalledTimes(2);
  expect(policy.mock.calls[1]![0]).toBe(`http://watch.test:${port}/end`);
});

test("🔒 a redirect to a blocked target throws", async () => {
  const port = await listen((_req, res) => {
    res.writeHead(302, { location: "http://169.254.169.254/latest/" });
    res.end();
  });
  const policy: NonNullable<SafeFetchOptions["policy"]> = async (raw) =>
    raw.includes("169.254")
      ? { ok: false, reason: "IP address is not public" }
      : allowAll(raw, noResolver);
  await expect(
    fetchWith({ policy })({ url: `http://watch.test:${port}/`, method: "GET" }),
  ).rejects.toThrow(/not public/);
});

test("🔒 gives up after MAX_REDIRECTS hops", async () => {
  const port = await listen((_req, res) => {
    res.writeHead(302, { location: "/again" });
    res.end();
  });
  await expect(
    fetchWith()({ url: `http://watch.test:${port}/`, method: "GET" }),
  ).rejects.toThrow(new RegExp(`${MAX_REDIRECTS} redirects`));
});

test("🔒 POST is never redirected — the 3xx is the final answer", async () => {
  const port = await listen((_req, res) => {
    res.writeHead(302, { location: "/elsewhere" });
    res.end();
  });
  const res = await fetchWith()({
    url: `http://watch.test:${port}/hook`,
    method: "POST",
    body: "{}",
  });
  expect(res.status).toBe(302);
});

/* ---------------------------------------------------------------- policy --- */

test("🔒 the DEFAULT policy is the real one — private targets are blocked", async () => {
  const real = createSafeFetch(); // no injection at all
  await expect(
    real({ url: "http://10.0.0.1/", method: "GET" }),
  ).rejects.toThrow(/fetch blocked/);
  await expect(
    real({ url: "http://localhost/", method: "GET" }),
  ).rejects.toThrow(/fetch blocked/);
});

/* --------------------------------------------------------------- timeout --- */

test("🔒 a slow server is aborted by the timeout", async () => {
  const port = await listen(() => {
    /* never responds */
  });
  await expect(
    fetchWith({ timeoutMs: 100 })({
      url: `http://watch.test:${port}/`,
      method: "GET",
    }),
  ).rejects.toThrow();
});

/* ------------------------------------------------- redirect credentials --- */

test("🔒 caller headers are DROPPED when a redirect crosses origins", async () => {
  const collected: Record<string, string | undefined>[] = [];
  const target = await listen((req, res) => {
    collected.push({
      authorization: req.headers["authorization"],
      "x-api-key": req.headers["x-api-key"] as string | undefined,
    });
    if (req.url === "/start") {
      // same host, DIFFERENT port => different origin
      res.writeHead(302, { location: `http://other.test:${target}/end` });
      res.end();
    } else res.end("done");
  });

  const res = await fetchWith()({
    url: `http://watch.test:${target}/start`,
    method: "GET",
    headers: { Authorization: "Bearer SECRET", "X-Api-Key": "KEY123" },
  });

  expect(res.body).toBe("done");
  expect(collected[0]).toEqual({
    authorization: "Bearer SECRET",
    "x-api-key": "KEY123",
  });
  expect(collected[1]).toEqual({
    authorization: undefined,
    "x-api-key": undefined,
  });
});

test("caller headers survive a SAME-origin redirect", async () => {
  const seen: (string | undefined)[] = [];
  const port = await listen((req, res) => {
    seen.push(req.headers["authorization"]);
    if (req.url === "/start") {
      res.writeHead(302, { location: "/end" });
      res.end();
    } else res.end("done");
  });
  await fetchWith()({
    url: `http://watch.test:${port}/start`,
    method: "GET",
    headers: { Authorization: "Bearer SECRET" },
  });
  expect(seen).toEqual(["Bearer SECRET", "Bearer SECRET"]);
});

// A scheme downgrade needs no separate test: the rule compares URL.origin,
// which includes the scheme, so https -> http is an origin change by
// construction — same code path as the cross-origin test above.

/* ------------------------------------------------------ header handling --- */

test("🔒 decompresses when content-encoding is uppercase GZIP", async () => {
  const port = await listen((_req, res) => {
    res.setHeader("content-encoding", "GZIP");
    res.end(gzipSync(Buffer.from("hello gzip")));
  });
  const res = await fetchWith()({ url: `http://watch.test:${port}/`, method: "GET" });
  expect(res.body).toBe("hello gzip");
  expect(res.headers["content-encoding"]).toBeUndefined();
});

test("a truncated response drops its stale content-length", async () => {
  const port = await listen((_req, res) => {
    res.end(Buffer.alloc(MAX_RESPONSE_BYTES + 50_000, "a"));
  });
  const res = await fetchWith()({ url: `http://watch.test:${port}/`, method: "GET" });
  expect(res.truncated).toBe(true);
  expect(res.headers["content-length"]).toBeUndefined();
});

// timeoutMs reaching pinnedAgent's headersTimeout/bodyTimeout is deliberately
// untested: the AbortSignal is set to the same value, so it always wins the
// race, and the only way to observe the agent's own deadline is a server that
// stalls for longer than the 10s default. Not worth 11 seconds on every CI run.
