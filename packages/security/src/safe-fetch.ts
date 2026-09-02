import { Agent, request } from "undici";
import { resolve4, resolve6 } from "node:dns/promises";
import { createUnzip } from "node:zlib";
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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** gzip and zlib-wrapped deflate; createUnzip sniffs which one it got. */
const DECODABLE_ENCODINGS = new Set(["gzip", "x-gzip", "deflate"]);

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

        // Only the actual redirect statuses: 304 Not Modified is also 3xx but
        // is a legitimate final answer with no Location.
        if (REDIRECT_STATUSES.has(res.statusCode) && req.method === "GET") {
          const location = res.headers["location"];
          await res.body.dump(); // release the connection
          // A duplicated Location header arrives as an array, and the value
          // may not parse. Both are broken servers — treat them as a blocked
          // fetch rather than letting a raw TypeError escape, or silently
          // returning the 3xx with an empty body as if it were content.
          const next =
            typeof location === "string"
              ? URL.parse(location, verdict.url)
              : null;
          if (!next) throw new Error("fetch blocked: unusable redirect target");
          url = next.href;
          continue;
        }

        const respHeaders: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          if (name === "set-cookie") continue;
          if (typeof value === "string") respHeaders[name] = value;
          else if (Array.isArray(value)) respHeaders[name] = value.join(", ");
        }

        let source: Readable = res.body;
        // content-encoding is a comma-separated coding LIST, and its values
        // are case-insensitive (RFC 9110). Comparing the whole header against
        // "gzip" would skip decompression for "GZIP", "identity, gzip" or a
        // trailing space, handing the caller compressed bytes decoded as utf8
        // mojibake — which then reads as "the page changed" on every run.
        const codings = (respHeaders["content-encoding"] ?? "")
          .split(",")
          .map((coding) => coding.trim().toLowerCase())
          .filter((coding) => coding !== "" && coding !== "identity");
        if (codings.length > 0) {
          // We only ever ask for gzip, so anything else is a misbehaving
          // server. Fail loudly rather than return binary garbage as text.
          if (codings.length > 1 || !DECODABLE_ENCODINGS.has(codings[0]!)) {
            await res.body.dump();
            throw new Error(
              `fetch blocked: unsupported content-encoding "${respHeaders["content-encoding"]}"`,
            );
          }
          const unzip = createUnzip();
          res.body.on("error", (e) => unzip.destroy(e));
          source = res.body.pipe(unzip);
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
