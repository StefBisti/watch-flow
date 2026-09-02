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
- every occurrence of a known secret value is replaced, in string values
  AND in key names (resolved {{secret.*}} values end up embedded in
  rendered output, which can be keyed by them too)
- Error, Map and Set are converted to plain data first: Object.entries
  cannot see a non-enumerable `message`/`stack`, so an Error would
  otherwise scrub down to {} and vanish from the log entirely
- the input is never mutated; a new structure is returned
- never throws: cycles become "[CIRCULAR]"
 */
export function redact(value: unknown, secretValues: string[] = []): unknown {
  const secrets = secretValues
    .filter((s) => s.length >= MIN_SECRET_LENGTH)
    // Longest first: with ["hunter2", "hunter2extra"], replacing the shorter
    // one first leaves "extra" behind in the log.
    .sort((a, b) => b.length - a.length);

  // The set holds the CURRENT PATH, not every object ever seen: two fields
  // referencing the same object is sharing, not a cycle, and the second one
  // must still be walked rather than dropped.
  const path = new Set<object>();

  const scrubString = (s: string): string => {
    let out = s;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out;
  };

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v;
    if (path.has(v)) return "[CIRCULAR]";

    path.add(v);
    try {
      if (Array.isArray(v)) return v.map(walk);
      if (v instanceof Error) {
        return walk({
          name: v.name,
          message: v.message,
          stack: v.stack,
          ...(v.cause === undefined ? {} : { cause: v.cause }),
        });
      }
      if (v instanceof Map) return walk(Object.fromEntries(v));
      if (v instanceof Set) return walk([...v]);

      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v)) {
        out[scrubString(key)] = SENSITIVE_KEYS.test(key)
          ? REDACTED
          : walk(val);
      }
      return out;
    } finally {
      path.delete(v);
    }
  };

  return walk(value);
}
