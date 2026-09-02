import { Agent, request } from "undici";
import { resolve4, resolve6 } from "node:dns/promises";
import { createGunzip } from "node:zlib";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { checkUrl, type Resolver, type UrlPolicyResult } from "./url-policy.ts";
import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
} from "./limits.ts";

export type SafeFetchRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type SafeFetchResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

// A + AAAA together; throws when neither resolve
export const defaultResolver: Resolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  const ips = [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
  if (ips.length === 0) throw new Error(`could not resolve ${hostname}`);
  return ips;
};

function pinnedAgent(ips: string[], timeoutMs: number): Agent {
  return new Agent({
    connect: {
      lookup(_hostname, options, callback) {
        const addrs = ips.map((address) => ({
          address,
          family: isIP(address),
        }));
        if (options.all) callback(null, addrs);
        else callback(null, addrs[0]!.address, addrs[0]!.family);
      },
    },
    // Must track the caller's timeout: undici's own deadlines would
    // otherwise cap a deliberately raised timeoutMs at the default.
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

const DEFAULT_USER_AGENT = "WatchFlowBot/0.1 (+https://watchflow.dev)";

const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "cookie",
  "content-length",
  "connection",
  "transfer-encoding",
  "accept-encoding",
]);

async function readCapped(
  source: Readable,
): Promise<{ body: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total + buf.length > MAX_RESPONSE_BYTES) {
      chunks.push(buf.subarray(0, MAX_RESPONSE_BYTES - total));
      return { body: Buffer.concat(chunks).toString("utf8"), truncated: true };
    }
    chunks.push(buf);
    total += buf.length;
  }
  return { body: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

export type SafeFetchOptions = {
  resolver?: Resolver;
  policy?: (raw: string, resolve: Resolver) => Promise<UrlPolicyResult>;
  timeoutMs?: number;
};

export function createSafeFetch(opts: SafeFetchOptions = {}) {
  const resolver = opts.resolver ?? defaultResolver;
  const policy = opts.policy ?? checkUrl;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;

  return async function safeFetch(
    req: SafeFetchRequest,
  ): Promise<SafeFetchResponse> {
    const signal = AbortSignal.any([
      ...(req.signal ? [req.signal] : []),
      AbortSignal.timeout(timeoutMs),
    ]);

    const callerHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers ?? {})) {
      if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
        callerHeaders[name.toLowerCase()] = value;
      }
    }

    let url = req.url;
    let previousOrigin: string | null = null;
    let dropCallerHeaders = false;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // 🔒 Re-validated on EVERY hop. A public site 302ing to
      // http://169.254.169.254/ is the classic SSRF bypass.
      const verdict = await policy(url, resolver);
      if (!verdict.ok) throw new Error(`fetch blocked: ${verdict.reason}`);

      // 🔒 Caller headers were consented to ONE origin. A watched site can
      // 302 anywhere public, so re-sending Authorization / X-Api-Key across
      // an origin change hands the user's credentials to the redirect
      // target. Drop them all, permanently, once the chain crosses origins
      // (a scheme downgrade changes the origin too, so https->http is
      // covered). The flag is sticky: the spec never restores them.
      if (previousOrigin !== null && verdict.url.origin !== previousOrigin) {
        dropCallerHeaders = true;
      }
      previousOrigin = verdict.url.origin;

      const headers: Record<string, string> = dropCallerHeaders
        ? {}
        : { ...callerHeaders };
      headers["accept-encoding"] = "gzip";
      headers["user-agent"] ??= DEFAULT_USER_AGENT;

      const agent = pinnedAgent(verdict.ips, timeoutMs);
      try {
        const res = await request(verdict.url, {
          dispatcher: agent,
          method: req.method,
          headers,
          body: req.body,
          signal,
        });

        const location = res.headers["location"];
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          typeof location === "string" &&
          req.method === "GET"
        ) {
          await res.body.dump(); // release the connection
          url = new URL(location, verdict.url).href;
          continue;
        }

        const respHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          if (name === "set-cookie") continue;
          if (typeof value === "string") respHeaders[name] = value;
          else if (Array.isArray(value)) respHeaders[name] = value.join(", ");
        }

        let source: Readable = res.body;
        // Header VALUES are case-insensitive per RFC 9110: a server sending
        // "GZIP" or "x-gzip" would otherwise skip decompression and hand
        // back raw deflate bytes decoded as utf8 mojibake.
        const encoding = respHeaders["content-encoding"]?.toLowerCase();
        if (encoding === "gzip" || encoding === "x-gzip") {
          const gunzip = createGunzip();
          res.body.on("error", (e) => gunzip.destroy(e));
          source = res.body.pipe(gunzip);
          delete respHeaders["content-encoding"];
          delete respHeaders["content-length"];
        }
        const { body, truncated } = await readCapped(source);
        if (truncated) {
          res.body.destroy();
          // The header would still advertise the full, untruncated size.
          delete respHeaders["content-length"];
        }

        return {
          status: res.statusCode,
          headers: respHeaders,
          body,
          truncated,
        };
      } finally {
        await agent.close();
      }
    }
    throw new Error(`fetch blocked: more than ${MAX_REDIRECTS} redirects`);
  };
}
