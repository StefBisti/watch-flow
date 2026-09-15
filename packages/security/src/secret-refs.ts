import { redact } from "./redact.ts";
import type { SafeFetchRequest, SafeFetchResponse } from "./safe-fetch.ts";

type Fetch = (req: SafeFetchRequest) => Promise<SafeFetchResponse>;

// Same name charset as the web SecretSchema — keep the two in sync.
const SECRET_REF = /\{\{secret\.([A-Z][A-Z0-9_]{0,63})\}\}/g;

/**
 * Swaps {{secret.NAME}} for its decrypted value in header VALUES only.
 * Throws on an unknown name
 */
export function resolveSecretRefs(
  headers: Record<string, string> | undefined,
  secrets: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      // Replacer FUNCTION, not a string: a string replacement expands $&, $1
      // and $$ — a token containing "$&" would be silently rewritten.
      value.replace(SECRET_REF, (_, ref: string) => {
        if (!Object.hasOwn(secrets, ref)) {
          throw new Error(`unknown secret ${ref}`);
        }
        return secrets[ref];
      }),
    ]),
  );
}

/**
 * Wraps a fetch so secrets go out in request headers and never come back in.
 *
 * 🔒 An API that echoes the token (httpbin, debug endpoints, error pages)
 * would otherwise carry it into every downstream node: the log preview, the
 * compare_last snapshot, the email body — and a webhook, which sends it to a
 * DIFFERENT host than the one the user trusted with it. Scrubbing here, once,
 * means nothing after this point can hold it, and later truncation can only
 * ever cut "[REDACTED]".
 */
export function withSecrets(
  inner: Fetch,
  secrets: Record<string, string>,
): Fetch {
  const values = Object.values(secrets);
  return async (req) => {
    const res = await inner({
      ...req,
      headers: resolveSecretRefs(req.headers, secrets),
    });
    // ponytail: safeFetch's 2 MB cap can split an echoed token and leave a
    // prefix behind. Only a target that already holds the token can aim for
    // that byte; add a tail-prefix scrub if secrets ever reach other parties.
    return { ...res, body: redact(res.body, values) as string };
  };
}
