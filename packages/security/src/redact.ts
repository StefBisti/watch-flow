const REDACTED = "[REDACTED]";

// "key" also hits "monkey" and over-redacts
const SENSITIVE_KEYS = /(authorization|cookie|token|secret|key|password)/i;

/*
Secret values shorter than this are not searched for inside strings:
redacting every occurrence of "" or "a" would destroy the whole log.
Real tokens are never this short.
 */
const MIN_SECRET_LENGTH = 4;

/*
Scrubs a JSON-serializable value (a RunResult log, an error payload)
before it is persisted or shipped to Sentry.

- any object key matching SENSITIVE_KEYS has its entire value replaced
- every occurrence of a known secret value inside any string is replaced
  (resolved {{secret.*}} values end up embedded in rendered output)
- the input is never mutated; a new structure is returned
- never throws: cycles become "[CIRCULAR]"
 */
export function redact(value: unknown, secretValues: string[] = []): unknown {
  const secrets = secretValues.filter((s) => s.length >= MIN_SECRET_LENGTH);
  const seen = new WeakSet<object>();

  const scrubString = (s: string): string => {
    let out = s;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out;
  };

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v;
    if (seen.has(v)) return "[CIRCULAR]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v)) {
      out[key] = SENSITIVE_KEYS.test(key) ? REDACTED : walk(val);
    }
    return out;
  };

  return walk(value);
}
