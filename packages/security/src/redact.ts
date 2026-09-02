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
Attacker-controlled JSON (a fetched response body landing in a RunResult)
can nest arbitrarily deep; without a cap the walk blows the call stack and
takes the caller's log-persistence path with it.
 */
const MAX_DEPTH = 200;

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
- never throws: cycles become "[CIRCULAR]", over-deep nesting "[TRUNCATED]"
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

  // ...but an ancestors-only set puts no bound on total work: an object
  // reachable by many paths would be re-walked once per path, which is
  // exponential on a diamond-shaped log (measured: OOM at 25 levels).
  // Memoising cycle-free subtrees restores linear work.
  const memo = new WeakMap<object, unknown>();
  let circularHits = 0;

  const scrubString = (s: string): string => {
    let out = s;
    for (const secret of secrets) out = out.split(secret).join(REDACTED);
    return out;
  };

  const scrub = (v: object, depth: number): unknown => {
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));

    if (v instanceof Error) {
      // Own enumerable props FIRST — code, errno, syscall, statusCode, meta,
      // AggregateError.errors are exactly what a run log exists to capture —
      // then the non-enumerable trio Object.entries cannot see.
      return walk(
        {
          ...v,
          name: v.name,
          message: v.message,
          stack: v.stack,
          ...(v.cause === undefined ? {} : { cause: v.cause }),
        },
        depth,
      );
    }
    if (v instanceof Map) {
      // Object.fromEntries string-coerces keys, so {a:1} and "[object Object]"
      // collide and entries are silently lost. Only safe when every key is
      // already a string; otherwise keep the entry pairs.
      const stringKeyed = [...v.keys()].every((k) => typeof k === "string");
      return stringKeyed
        ? walk(Object.fromEntries(v), depth)
        : walk([...v], depth);
    }
    if (v instanceof Set) return walk([...v], depth);

    // 🔒 Null prototype: on a plain {} literal a "__proto__" key hits
    // Object.prototype's inherited setter instead of creating an own
    // property, so the entry silently disappears. redact() runs over fetched
    // response bodies, which the watched site controls.
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, val] of Object.entries(v)) {
      // Two distinct keys can scrub to the same name; keep both rather than
      // letting the later one silently overwrite the earlier.
      const scrubbed = scrubString(key);
      let name = scrubbed;
      for (let i = 2; Object.hasOwn(out, name); i++) name = `${scrubbed} (${i})`;
      out[name] = SENSITIVE_KEYS.test(key) ? REDACTED : walk(val, depth + 1);
    }
    return out;
  };

  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") return scrubString(v);
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v;
    if (path.has(v)) {
      circularHits++;
      return "[CIRCULAR]";
    }
    if (depth > MAX_DEPTH) return "[TRUNCATED]";
    if (memo.has(v)) return memo.get(v);

    path.add(v);
    try {
      const before = circularHits;
      const result = scrub(v, depth);
      // Only cache subtrees that contained no cycle: a "[CIRCULAR]" marker
      // depends on the path taken to get here, so it must not be reused.
      if (circularHits === before) memo.set(v, result);
      return result;
    } finally {
      path.delete(v);
    }
  };

  return walk(value, 0);
}
