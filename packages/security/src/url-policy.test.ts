import { expect, test, vi } from "vitest";
import { checkUrl, type Resolver } from "./url-policy.ts";

const resolver =
  (table: Record<string, string[]>): Resolver =>
  async (hostname) => {
    const ips = table[hostname];
    if (!ips) throw new Error(`NXDOMAIN: ${hostname}`);
    return ips;
  };

const example = resolver({ "example.com": ["93.184.216.34"] });

const rejects = async (raw: string, r: Resolver, reason: RegExp) => {
  const res = await checkUrl(raw, r);
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.reason).toMatch(reason);
};

/* ------------------------------------------------------------ accepts --- */

test("accepts a public hostname and returns its validated IPs", async () => {
  const res = await checkUrl("https://example.com/page?q=1", example);
  expect(res).toMatchObject({ ok: true, ips: ["93.184.216.34"] });
});

test("accepts an explicit default port", async () => {
  expect((await checkUrl("https://example.com:443/", example)).ok).toBe(true);
});

test("accepts a public IP literal without resolving", async () => {
  const spy = vi.fn();
  const res = await checkUrl("http://8.8.8.8/health", spy);
  expect(res).toMatchObject({ ok: true, ips: ["8.8.8.8"] });
  expect(spy).not.toHaveBeenCalled();
});

/* ---------------------------------------------------------- str checks --- */

test("🔒 rejects non-http protocols", async () => {
  for (const raw of [
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    await rejects(raw, example, /only http and https/);
  }
});

test("🔒 rejects credentials in the URL", async () => {
  await rejects("https://user:pass@example.com/", example, /credentials/);
});

test("🔒 rejects non-allowlisted ports", async () => {
  await rejects("http://example.com:8080/", example, /port 8080/);
});

test("rejects garbage", async () => {
  await rejects("not a url at all", example, /not a valid URL/);
});

/* ------------------------------------------------------------ denylist --- */

test("🔒 rejects denylisted hostnames, including the trailing-dot form", async () => {
  const open = resolver({
    localhost: ["93.184.216.34"], // even if DNS lied and said it was public
    "foo.local": ["93.184.216.34"],
    "a.b.internal": ["93.184.216.34"],
    "metadata.google.internal": ["93.184.216.34"],
  });
  for (const host of [
    "localhost",
    "localhost.",
    "foo.local",
    "a.b.internal",
    "metadata.google.internal",
  ]) {
    await rejects(`http://${host}/`, open, /hostname is not allowed/);
  }
});

test("a hostname merely containing 'local' is fine", async () => {
  const r = resolver({ "notlocal.com": ["93.184.216.34"] });
  expect((await checkUrl("http://notlocal.com/", r)).ok).toBe(true);
});

/* ---------------------------------------------------------- IP literals --- */

test("🔒 rejects private and mapped IP literals", async () => {
  for (const raw of [
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:10.0.0.1]/",
  ]) {
    await rejects(raw, example, /not public/);
  }
});

test("🔒 exotic IPv4 spellings are canonicalized by URL and then caught", async () => {
  // decimal, hex, octal — all become 127.x forms inside new URL()
  for (const raw of [
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
  ]) {
    await rejects(raw, example, /not public/);
  }
});

/* ----------------------------------------------------------- resolution --- */

test("🔒 rejects a hostname resolving to a private address", async () => {
  const r = resolver({ "internal.evil.com": ["10.0.0.5"] });
  await rejects("http://internal.evil.com/", r, /non-public/);
});

test("🔒 rejects a MIXED public + private resolution", async () => {
  const r = resolver({ "evil.com": ["93.184.216.34", "10.0.0.5"] });
  await rejects("http://evil.com/", r, /non-public/);
});

test("🔒 fails closed on NXDOMAIN instead of throwing", async () => {
  await rejects("http://nxdomain.test/", example, /did not resolve/);
});

test("🔒 fails closed on an empty answer", async () => {
  const r = resolver({ "empty.test": [] });
  await rejects("http://empty.test/", r, /did not resolve/);
});

test("🔒 rejects .localhost subdomains and repeated trailing dots", async () => {
  // DNS deliberately answers with a public address: these must fail at the
  // hostname layer, before resolution, exactly like "localhost." does.
  const open = resolver({
    "a.localhost": ["93.184.216.34"],
    "deep.sub.localhost": ["93.184.216.34"],
    localhost: ["93.184.216.34"],
  });
  for (const host of ["a.localhost", "deep.sub.localhost", "localhost.."]) {
    await rejects(`http://${host}/`, open, /hostname is not allowed/);
  }
});
