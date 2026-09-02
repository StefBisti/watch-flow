import { isIP } from "node:net";
import { isPublicIp } from "./ip.ts";
import { ALLOWED_PORTS } from "./limits.ts";

export type Resolver = (hostname: string) => Promise<string[]>;

export type UrlPolicyResult =
  | { ok: true; url: URL; ips: string[] }
  | { ok: false; reason: string };

const fail = (reason: string): UrlPolicyResult => ({ ok: false, reason });

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);
// ".localhost" is RFC 6761 reserved and resolves to loopback in most
// resolvers, so "a.localhost" belongs here next to "localhost" itself.
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost"];

export async function checkUrl(
  raw: string,
  resolve: Resolver,
): Promise<UrlPolicyResult> {
  const url = URL.parse(raw);
  if (!url) return fail("not a valid URL");

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("only http and https are allowed");
  }
  if (url.username || url.password) {
    return fail("credentials in URLs are not allowed");
  }

  if (url.port !== "" && !ALLOWED_PORTS.includes(Number(url.port))) {
    return fail(`port ${url.port} is not allowed`);
  }

  // Strip EVERY trailing dot ("localhost.." must reach the denylist too) and
  // write it back onto the URL, so the verdict URL, the outgoing Host header
  // and safeFetch's origin comparison all agree with the name we actually
  // denylisted and resolved. Leaving the dot on url.hostname made a same-host
  // redirect look cross-origin and dropped the caller's credentials.
  if (/\.+$/.test(url.hostname)) {
    url.hostname = url.hostname.replace(/\.+$/, "");
  }
  let hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return fail("hostname is not allowed");
  }

  if (isIP(hostname) !== 0) {
    return isPublicIp(hostname)
      ? { ok: true, url, ips: [hostname] }
      : fail("IP address is not public");
  }

  let ips: string[];
  try {
    ips = await resolve(hostname);
  } catch {
    return fail("hostname did not resolve");
  }
  if (ips.length === 0) return fail("hostname did not resolve");

  for (const ip of ips) {
    if (!isPublicIp(ip))
      return fail("hostname resolves to a non-public address");
  }

  return { ok: true, url, ips };
}
