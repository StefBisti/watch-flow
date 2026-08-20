# WatchFlow — Project Plan v2 (DevSecOps edition)

> Visual page/API change monitor. Build a flow (fetch → extract → compare → notify), run it on a schedule, get notified.
> Goal: production-quality portfolio app with real users and a **visible, documented security posture**. No revenue.

**How to use this doc:** work top to bottom. Each week has a checklist. Tick boxes as you go. 🔒 marks security items — never skip a 🔒.

**The DevSecOps story for your resume:** "Security is automated in the pipeline, not done at the end." Every PR is scanned, every dependency is pinned and checked, secrets never touch the repo, user-supplied URLs are sandboxed, and there's a written threat model. That sentence is what interviewers remember.

---

## 0. Decisions already made (don't re-decide these)

| Area | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Your stack |
| UI | shadcn/ui + Tailwind | Your stack |
| Flow editor | @xyflow/react (React Flow v12) | Core differentiator |
| DB | Postgres + Prisma | Your stack |
| Validation | zod, shared between web + worker | Single source of truth; also a security boundary |
| Queue | BullMQ + Redis | Retries, dedupe, resume-worthy |
| Worker | Separate Node process (tsx) in the same monorepo | Vercel can't run long jobs; also isolates the part that touches untrusted URLs |
| Monorepo | Turborepo + pnpm | `apps/web`, `apps/worker`, `packages/*` |
| Auth | Auth.js v5 (GitHub + Google + magic link) | No passwords to store |
| Email | Resend | Free tier |
| Hosting | Vercel (web) + Fly.io (worker) + Neon (Postgres) + Upstash (Redis) | Free tiers; Fly lets you run the worker in its own tiny VM |
| Fetching | `undici` with a custom dispatcher, no headless browser in v1 | Scope + attack surface |
| 🔒 Secrets | Doppler or 1Password CLI → injected at runtime; never in `.env` committed | Secret hygiene |
| 🔒 CI | GitHub Actions with pinned action SHAs, OIDC to deploy (no long-lived tokens) | Supply chain |
| 🔒 Scanning | Semgrep (SAST), Gitleaks (secrets), Trivy (container + deps), pnpm audit, CodeQL, OWASP ZAP baseline (DAST) | Defense in depth, all free |
| 🔒 Policy | Dependabot, Renovate-style weekly updates, branch protection, signed commits | Hygiene |

**Cut from v1:** Playwright/JS rendering, screenshot diff, digests, teams, Slack OAuth, billing, templates, mobile. (Still cut. Security work replaces the time these would have taken.)

---

## 1. Repo layout

```
watchflow/
  .github/
    workflows/
      ci.yml              lint, typecheck, test, build
      security.yml        semgrep, gitleaks, codeql, trivy, pnpm audit
      dast.yml            ZAP baseline against preview URL (nightly + on release)
      deploy-worker.yml   build image → sign with cosign → push → fly deploy
    dependabot.yml
    CODEOWNERS
  apps/
    web/                  Next.js
    worker/               BullMQ worker + scheduler
  packages/
    db/                   Prisma schema + client
    flow/                 FlowSchema, node registry, engine (pure TS, no I/O deps)
    security/             ssrf guard, url policy, rate-limit helpers, sanitizers (shared)
    config/               tsconfig, eslint (incl. eslint-plugin-security)
  docs/
    THREAT_MODEL.md       STRIDE table (section 8)
    SECURITY.md           disclosure policy (also at repo root)
    ARCHITECTURE.md
  .env.example            keys only, no values
  .gitleaks.toml
  .semgrep.yml
  docker-compose.yml      local Postgres + Redis
  turbo.json
```

Rules:
1. `packages/flow` has zero I/O dependencies; `fetch` is injected. Testable and auditable.
2. `packages/security` is the **only** place that decides whether a URL may be contacted. Both `http_fetch` and `webhook` nodes call it. One choke point = easy to audit, easy to test, easy to talk about.

---

## 2. Data model (Prisma)

Same as v1 plus security-relevant additions (🔒):

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  image         String?
  role          String   @default("user")   // 🔒 user | admin
  createdAt     DateTime @default(now())
  deletedAt     DateTime?                   // 🔒 soft delete → hard delete job after 30 d (GDPR)
  watches       Watch[]
  auditLogs     AuditLog[]
}

model Watch {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  flow        Json
  intervalMin Int
  enabled     Boolean   @default(true)
  nextRunAt   DateTime
  lastRunAt   DateTime?
  lastStatus  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  runs        Run[]
  snapshots   Snapshot[]
  @@index([enabled, nextRunAt])
  @@index([userId])
}

model Run {
  id          String    @id @default(cuid())
  watchId     String
  watch       Watch     @relation(fields: [watchId], references: [id], onDelete: Cascade)
  status      String
  triggered   String
  error       String?
  log         Json      // 🔒 redact headers/secrets before storing (section 7)
  startedAt   DateTime  @default(now())
  endedAt     DateTime?
  notifications Notification[]
  @@index([watchId, startedAt])
}

model Snapshot {
  id        String   @id @default(cuid())
  watchId   String
  watch     Watch    @relation(fields: [watchId], references: [id], onDelete: Cascade)
  value     String   // truncated at 10 KB
  hash      String
  createdAt DateTime @default(now())
  @@index([watchId, createdAt])
}

model Notification {
  id        String   @id @default(cuid())
  runId     String
  run       Run      @relation(fields: [runId], references: [id], onDelete: Cascade)
  channel   String
  target    String   // 🔒 for webhooks store host only, not full URL w/ tokens
  status    String
  error     String?
  createdAt DateTime @default(now())
}

// 🔒 Secrets users give us (custom headers like Authorization for their APIs)
model WatchSecret {
  id         String   @id @default(cuid())
  watchId    String
  name       String   // e.g. "API_TOKEN", referenced in flow as {{secret.API_TOKEN}}
  ciphertext Bytes    // AES-256-GCM, key from env (KMS later), never returned to client after creation
  iv         Bytes
  createdAt  DateTime @default(now())
  @@unique([watchId, name])
}

// 🔒 Audit trail
model AuditLog {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])
  action    String   // watch.create | watch.update | watch.delete | secret.create | login | account.delete
  target    String?
  ip        String?  // 🔒 hashed (sha256 + daily salt) — we don't need raw IPs
  userAgent String?
  meta      Json?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}
```

Retention: 100 runs / 200 snapshots per watch; audit logs 90 days; soft-deleted users purged after 30 days. Nightly job. Document this in a `PRIVACY.md` — one paragraph is enough.

---

## 3. Flow schema (zod) — the contract AND a security boundary

```ts
export const NodeType = z.enum([
  "http_fetch", "css_selector", "json_path", "regex",
  "compare_last", "condition", "email", "webhook",
]);

export const FlowSchema = z.object({
  version: z.literal(1),
  nodes: z.array(BaseNode).min(1).max(25),          // 🔒 cap nodes
  edges: z.array(Edge).max(50),                     // 🔒 cap edges
}).superRefine((flow, ctx) => {
  // exactly one http_fetch with no incoming edges
  // no cycles (DFS)
  // every node reachable from source
  // every edge references existing nodes
  // ≥1 action node
  // 🔒 every node.data validated by registry[type].configSchema (strict(), no unknown keys)
  // 🔒 string fields have .max() (urls 2048, selectors 500, templates 2000, regex 200)
});
```

🔒 Rules:
1. All node config schemas use `.strict()` — unknown keys rejected (prevents smuggling fields).
2. All strings have max lengths.
3. Regex patterns validated at save time with a ReDoS check (`safe-regex2` or re2 via `re2` package; if re2 unavailable, run with 1 s timeout in a worker thread).
4. URLs parsed with `new URL()`, protocol ∈ {http, https} only, validated again by `packages/security/urlPolicy` at runtime (DNS can change between save and run → TOCTOU, so validate at both points).
5. Parse on save (web) **and** on execute (worker). Stored JSON is never trusted.

---

## 4. Node registry + engine

Same shape as v1 (`NodeDefinition<TConfig>` with `configSchema`, `execute`, injected `ctx.fetch`). Security deltas:

| Node | 🔒 Security behaviour |
|---|---|
| `http_fetch` | Goes through `safeFetch()` (section 7). 10 s timeout, 2 MB cap, ≤3 redirects each re-validated, `Accept-Encoding: gzip` only, strips `Set-Cookie`. Custom headers may reference `{{secret.NAME}}` — resolved in the worker only, never sent to client, redacted from logs. |
| `css_selector` | cheerio with `xml: false`; input capped at 2 MB already. Output truncated to 10 KB. |
| `json_path` | `jsonpath-plus` with `eval: false` (❗ default allows JS eval — this is a real CVE class). |
| `regex` | Pattern pre-validated; executed with timeout guard. |
| `compare_last` | Numeric parsing via a strict parser, never `eval`/`Function`. |
| `condition` | Same. |
| `email` | Only to the owner's verified email in v1. Templates rendered with a **logic-less** engine (mustache with HTML-escaping on) — never string-concat into HTML. |
| `webhook` | Same `safeFetch()` policy. Body template rendered with escaping. Response body is discarded (we don't want to store arbitrary third-party responses). |

Engine (`runFlow`) unchanged, plus:
- 🔒 Per-node `AbortSignal.timeout(10_000)`, per-run 30 s, per-run memory soft cap (check `process.memoryUsage()` between nodes; abort > 256 MB).
- 🔒 `log` entries pass through `redact()` before persisting: drops `Authorization`, `Cookie`, `X-Api-Key`, anything matching `/(token|secret|key|password)/i`, and any resolved `{{secret.*}}` values.
- 🔒 Fan-in not allowed (simpler graph = smaller attack surface for cycles/explosions).

Tests (Vitest) — v1 list **plus** 🔒: SSRF guard (IPv4 private, IPv6 ULA/loopback, `0.0.0.0`, decimal/octal IP forms, DNS rebinding simulated via mocked resolver, redirect to private IP), ReDoS pattern rejection, `.strict()` unknown-key rejection, template escaping, redact(), size caps.

---

## 5. Worker + scheduler

As v1 (scheduler tick every 60 s, deterministic job IDs, concurrency 5, backoff 10 s/60 s/5 min, graceful SIGTERM). Security deltas:

1. 🔒 Worker runs as a **non-root user** in a distroless/Alpine image, read-only FS, `--cap-drop=ALL`, no shell.
2. 🔒 Worker has **outbound-only** network; no ports exposed. Health via Redis heartbeat, not HTTP.
3. 🔒 Worker uses a **separate DB role** with only the grants it needs (SELECT watches/secrets, INSERT/UPDATE runs/snapshots/notifications). The web app's role can't read `WatchSecret.ciphertext`… actually it must write it; so: web role = INSERT on WatchSecret, no SELECT on ciphertext (use a view or column privileges). Document this — it's a great talking point.
4. 🔒 Secret decryption key (`SECRETS_MASTER_KEY`) exists **only** in the worker's environment. Web never holds it. Worker decrypts at execute time, zeroes buffers after.
5. 🔒 Egress: on Fly, use a dedicated app with a static outbound IP so you can publish it ("if you see this IP, it's WatchFlow") and so you can later add an egress allow/deny list.
6. 🔒 Per-host rate limit in Redis (e.g. ≤1 fetch / 10 s / host across all users) — prevents you being used as a DDoS tool and gets you blocked less.

---

## 6. Web app

Pages and editor as v1. Security deltas:

1. 🔒 **Auth.js hardening:** `session.strategy = "database"`, short session maxAge (7 d), `useSecureCookies`, `trustHost` only for known hosts, CSRF handled by Auth.js; magic-link tokens 10 min expiry, single-use.
2. 🔒 **Authorization:** every server action/route handler does `const user = await requireUser()` then scopes Prisma queries by `userId`. Write a single `authz.ts` helper: `assertOwnsWatch(userId, watchId)`. Test IDOR explicitly (user A cannot GET/PUT/DELETE user B's watch by ID).
3. 🔒 **Security headers** via `next.config.ts` `headers()`:
   - `Content-Security-Policy` with nonces (Next 15 supports nonce via middleware). No `unsafe-inline` for scripts. Allow your own origin + Sentry.
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   - `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - Verify with securityheaders.com → aim for A+. Screenshot it for the README.
4. 🔒 **Input handling:** server actions validate with zod first line; route handlers the same. No `dangerouslySetInnerHTML` anywhere except the diff view, which renders through `DOMPurify` (or better: render diff as React elements, never as HTML).
5. 🔒 **Rate limiting:** Upstash Ratelimit on mutations (10/min/user), on auth routes (5/min/IP), on manual run (3/min/watch).
6. 🔒 **Secrets UI:** "Add header secret" form → POST → encrypted → UI only ever shows the name and `••••`. No "reveal". Edit = replace.
7. 🔒 **Account deletion:** self-service, soft-delete → purge job. Export-my-data JSON endpoint (cheap to build, looks responsible).
8. 🔒 Admin routes (`/admin/queues` Bull Board, `/admin/audit`) behind `role === "admin"` **and** an IP/ Vercel protection bypass header, not just email match.
9. 🔒 Generic error messages to users; full errors to Sentry with PII scrubbing (`beforeSend`).

---

## 7. `packages/security` — the choke point

```
packages/security/src/
  urlPolicy.ts      parse → protocol allowlist → hostname rules → DNS resolve → IP classification
  safeFetch.ts      uses urlPolicy, custom undici Agent w/ `connect.lookup` that re-checks resolved IPs (anti-rebinding), redirect re-validation, size/time caps, header stripping
  redact.ts         log/error scrubber
  crypto.ts         AES-256-GCM encrypt/decrypt for WatchSecret, key from env, versioned key IDs for rotation
  ratelimit.ts      Upstash wrappers with named policies
  template.ts       escape-by-default renderer for email/webhook templates
  limits.ts         all numeric caps in one place
  index.ts
```

`urlPolicy` rules (write tests for each):
- protocol ∈ {http:, https:}
- no userinfo (`user:pass@host`)
- hostname not in denylist: `localhost`, `*.local`, `*.internal`, `metadata.google.internal`, cloud metadata IPs
- resolve A/AAAA; **every** returned IP must be public (reject 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, 100.64/10, ::1, fc00::/7, fe80::/10, ::ffff:x.x.x.x mapped)
- reject if the resolved IP set changes between check and connect (pin via undici `connect.lookup`)
- re-run on every redirect hop
- port ∈ {80, 443, 8080, 8443} (or just 80/443 in v1)

---

## 8. Threat model (docs/THREAT_MODEL.md) — write it in week 2, update in week 6

Keep it a one-page STRIDE table. Skeleton:

| Asset | Threat | STRIDE | Mitigation | Status |
|---|---|---|---|---|
| Internal network / cloud metadata | User points fetch at 169.254.169.254 or Redis | Info disclosure, Elevation | urlPolicy + pinned DNS + worker in egress-only VM with no internal services reachable | ✅ |
| Other users' watches | IDOR via guessed watch IDs | Tampering, Info disclosure | cuid IDs + `assertOwnsWatch` on every access + IDOR tests | ✅ |
| User-supplied API tokens | Leak via logs/DB dump/client | Info disclosure | AES-GCM at rest, key only in worker, redact(), never returned to client | ✅ |
| Worker host | Malicious HTML/JSON payload exploits parser | Elevation | size caps, `eval:false`, ReDoS guard, non-root read-only container, Trivy scans | ✅ |
| Third-party sites | WatchFlow used to DDoS/scrape | Abuse | per-host rate limit, min interval, max watches, public egress IP, robots.txt respect | ✅ |
| Session | CSRF / session fixation / token theft | Spoofing | Auth.js CSRF, Secure+HttpOnly+SameSite=Lax cookies, short maxAge, HSTS | ✅ |
| Webhook targets | Used to hit internal URLs of the webhook receiver | Elevation | same urlPolicy | ✅ |
| Email | Spam third parties | Abuse | only owner's verified email in v1 | ✅ |
| Supply chain | Malicious npm package / compromised action | Tampering | pnpm lockfile + `--frozen-lockfile`, pinned action SHAs, Dependabot, Trivy, npm provenance check, `minimumReleaseAge` in pnpm | ✅ |
| Secrets in repo | Accidental commit | Info disclosure | Gitleaks pre-commit + CI, `.env` gitignored, Doppler | ✅ |
| Availability | Runaway flow / queue flood | DoS | per-node+run timeouts, memory cap, concurrency limit, queue depth alert | ✅ |

---

## 9. CI/CD pipeline (the heart of the DevSecOps story)

### `ci.yml` — on every PR
1. checkout (pinned SHA) → pnpm install `--frozen-lockfile`
2. `pnpm lint` (eslint + `eslint-plugin-security` + `eslint-plugin-no-unsanitized`)
3. `pnpm typecheck`
4. `pnpm test --coverage` (Vitest); upload coverage; fail under 70 % on `packages/flow` and `packages/security`
5. `pnpm build`
6. Prisma `migrate diff` check (schema ↔ migrations in sync)

### `security.yml` — on every PR + nightly
1. **Gitleaks** — secrets scan of full history on PR, diff on push
2. **Semgrep** — `p/owasp-top-ten`, `p/nextjs`, `p/typescript`, plus 3–5 custom rules (e.g. "every `fetch(` outside `packages/security` is an error", "no `dangerouslySetInnerHTML`", "no `jsonpath` without `eval:false`")
3. **CodeQL** — JS/TS
4. **pnpm audit --prod --audit-level=high** + **Trivy fs** on the repo (deps) — fail on HIGH/CRITICAL with a documented allowlist file for accepted risks
5. **Trivy image** on the worker Docker image
6. **SBOM** — generate CycloneDX with `@cyclonedx/cyclonedx-npm` or `syft`, upload as artifact + attach to GitHub release
7. **Dependency review action** on PRs (blocks known-vuln introductions)
8. Results → GitHub Security tab (SARIF upload). Screenshot this for the README.

### `dast.yml` — nightly + on release
1. **OWASP ZAP baseline** against the Vercel preview/prod URL (unauthenticated) — fail on new medium+ alerts; allowlist file committed
2. (Stretch) authenticated ZAP scan using a test account cookie

### `deploy-worker.yml` — on push to `main`
1. Build image with Docker BuildKit, multi-stage, `node:22-alpine` → distroless runtime, non-root
2. Trivy scan (fail on CRITICAL)
3. **Sign with cosign** (keyless, OIDC)
4. Push to GHCR, `fly deploy --image ...`
5. Post-deploy smoke test: worker heartbeat appears in Redis within 120 s, else rollback

### Repo policy
- Branch protection on `main`: PR required, 1 approval (self-approve is fine solo — document it), required checks = ci + security, signed commits, linear history
- CODEOWNERS: `packages/security/**` and `.github/**` → you (show you'd gate these in a team)
- Dependabot: weekly, grouped, auto-merge patch for dev-deps only
- `SECURITY.md`: disclosure email, 90-day policy, hall of fame
- Pre-commit (`lefthook`): gitleaks, eslint --fix, prettier, typecheck on staged packages

---

## 10. Secrets & config

- 🔒 **No `.env` with values ever committed.** `.env.example` lists keys only.
- 🔒 Local dev: Doppler CLI (`doppler run -- pnpm dev`) or 1Password `op run`. Pick one, mention it in README.
- 🔒 Vercel + Fly secrets set via CLI from Doppler sync, not pasted in dashboards by hand (reproducible).
- 🔒 `SECRETS_MASTER_KEY` (32 bytes, base64) **only** in the worker env. Key ID prefix stored with ciphertext so you can rotate: `v1:` → `v2:` with a re-encrypt job.
- 🔒 GitHub Actions: OIDC to Fly/GHCR; no `FLY_API_TOKEN` stored if avoidable; otherwise scoped deploy token in an Environment with required reviewers.
- 🔒 Separate DB roles: `wf_web`, `wf_worker`, `wf_migrate`. Migrations run with `wf_migrate` only in CI.

Env keys:
```
DATABASE_URL / DIRECT_URL         (web role)
WORKER_DATABASE_URL               (worker role)
REDIS_URL
AUTH_SECRET, AUTH_GITHUB_ID/SECRET, AUTH_GOOGLE_ID/SECRET
RESEND_API_KEY, EMAIL_FROM
SECRETS_MASTER_KEY                (worker only)
IP_HASH_SALT                      (rotated daily via job or derived from date)
NEXT_PUBLIC_APP_URL
SENTRY_DSN
UPSTASH_REDIS_REST_URL/TOKEN      (ratelimit)
```

---

## 11. Observability & incident readiness

1. Structured logs (pino) with `redact` paths configured; `watchId`, `runId`, `jobId`, never payloads.
2. Sentry both apps, `sendDefaultPii: false`, `beforeSend` scrubber.
3. `/api/status`: worker heartbeat, queue counts, last deploy SHA. Public.
4. Alerts (free): Sentry email on new issue; a tiny GitHub Action cron that curls `/api/status` every 10 min and opens an issue if worker heartbeat > 5 min old (you're your own uptime monitor — cute for the README).
5. `docs/RUNBOOK.md`: what to do if (a) worker down, (b) queue flooding, (c) secret leaked (rotate order: revoke → rotate → redeploy → audit), (d) a site complains (disable host, reply template).
6. Audit log page for admin; users can see their own audit trail in settings.

---

## 12. Deployment

1. **Web → Vercel.** Deployment Protection on previews (Vercel auth). Env via Doppler sync.
2. **Worker → Fly.io.** Dockerfile (multi-stage, distroless, non-root, `USER 65532`, read-only root FS, `--cap-drop ALL`). `fly.toml` with no `[[services]]` (no inbound). Dedicated IPv4 for stable egress (~$2/mo; optional — or document the shared range).
3. **Postgres → Neon.** Three roles as above. Pooled URL for web, direct for worker/migrations. Enable IP allowlist if on a paid tier; otherwise rely on strong passwords + TLS `sslmode=require`.
4. **Redis → Upstash.** TLS (`rediss://`). Separate DB index for ratelimit vs queue.
5. **Migrations:** GitHub Action job with `wf_migrate`, runs before Vercel promote (use Vercel deploy hook after migrate succeeds).
6. **Releases:** tag `v0.x`, GitHub Release auto-generated notes + SBOM + cosign signature attached.

---

## 13. Week-by-week checklist

### Week 1 — Skeleton + pipeline skeleton (≈9 h)
- [ ] Turborepo, pnpm, `apps/web`, `apps/worker`, `packages/db`, `packages/flow`, `packages/security` (empty)
- [ ] docker-compose (Postgres 16, Redis 7), `.env.example`
- [ ] Prisma schema (section 2) incl. AuditLog, WatchSecret; `db:push`; seed
- [ ] Auth.js (GitHub); protected `/app`; `requireUser()` helper
- [ ] shadcn; dashboard list; plain-form Watch CRUD (no React Flow yet)
- [ ] 🔒 `ci.yml`: install/lint/typecheck/test/build with pinned action SHAs
- [ ] 🔒 Gitleaks in CI + `lefthook` pre-commit
- [ ] 🔒 Branch protection, Dependabot, `SECURITY.md`, CODEOWNERS
- [ ] 🔒 Doppler/1Password for local secrets
- [ ] Deploy web to Vercel + Neon
- **Done when:** signed-in CRUD works in prod, and a PR with a fake secret gets blocked by CI.

### Week 2 — Engine + security package + threat model (≈11 h)
- [ ] FlowSchema with caps + `.strict()` + superRefine rules
- [ ] Node registry, 8 executes; `jsonpath-plus` with `eval:false`; ReDoS check
- [ ] `runFlow` with topo sort, branching, timeouts, memory cap, `redact()` on log
- [ ] 🔒 `packages/security`: urlPolicy, safeFetch (undici agent with pinned lookup), redact, template, crypto, limits
- [ ] 🔒 Vitest: ~35 tests incl. the full SSRF matrix, ReDoS, strict schema, escaping, crypto roundtrip
- [ ] 🔒 Semgrep custom rule: `fetch(` only allowed in `packages/security`
- [ ] 🔒 `security.yml`: Semgrep + CodeQL + pnpm audit + Trivy fs; SARIF to Security tab
- [ ] 🔒 `docs/THREAT_MODEL.md` first draft (section 8)
- **Done when:** tests green, Security tab shows scans, threat model committed.

### Week 3 — Worker (≈11 h)
- [ ] BullMQ queue/worker/scheduler; processor; Resend + webhook notifiers; manual run + polling
- [ ] 🔒 WatchSecret encrypt (web) / decrypt (worker only); `{{secret.X}}` resolution in worker; redaction verified in stored logs
- [ ] 🔒 Separate DB roles `wf_web` / `wf_worker` / `wf_migrate`; column privilege on `WatchSecret.ciphertext`
- [ ] 🔒 Per-host rate limit in Redis
- [ ] 🔒 Dockerfile: multi-stage, distroless, non-root, read-only; `deploy-worker.yml` with Trivy image scan + cosign + Fly OIDC deploy
- [ ] Heartbeat + `/api/status`
- **Done when:** a prod watch with a secret header runs on schedule, emails you, and the secret never appears in DB logs or Sentry.

### Week 4 — Editor (≈12 h)
- [ ] React Flow canvas, palette, 8 custom nodes, `true/false` handles
- [ ] Sidebar forms (react-hook-form + zod per node); live validation; Save via server action
- [ ] Secrets UI (name + `••••`, replace-only)
- [ ] Test run panel with per-node status
- [ ] "Quick create" 4-node preset
- [ ] 🔒 CSP with nonces + all security headers; verify A+ on securityheaders.com
- [ ] 🔒 IDOR tests (Playwright or Vitest against route handlers) for watch/run/secret endpoints
- [ ] 🔒 Upstash rate limits on mutations, auth, manual run
- **Done when:** visual flow builds/tests/saves/runs; header grade A+; IDOR tests pass.

### Week 5 — History, polish, DAST, runbook (≈9 h)
- [ ] Run history + inspector (diff rendered as React elements, not HTML)
- [ ] Snapshot chart (recharts)
- [ ] Limits (10 watches / 15 min), robots.txt cache
- [ ] Nightly cleanup + soft-delete purge; export-my-data; delete account
- [ ] Audit log writes on all mutations + user-visible audit page
- [ ] Sentry with scrubbing, pino redact, Bull Board behind admin role
- [ ] 🔒 `dast.yml`: ZAP baseline against prod; fix findings; commit allowlist
- [ ] 🔒 SBOM generation + attach to release
- [ ] 🔒 `docs/RUNBOOK.md` (worker down / queue flood / secret leak / abuse complaint)
- [ ] 🔒 Manual pass through OWASP ASVS L1 checklist; note gaps in threat model "Status" column
- **Done when:** ZAP clean, SBOM on a tagged release, runbook written.

### Week 6 — Launch (≈7 h)
- [ ] Landing page: 3 recipes + GIF + **"Security" section** linking threat model, scans, disclosure policy, egress IP
- [ ] README: architecture diagram, pipeline diagram, screenshots of Security tab + securityheaders A+, "why a separate worker", "how we sandbox user URLs", self-host guide
- [ ] Public `/status`
- [ ] Tag `v0.1.0` (release with SBOM + signature)
- [ ] Post: Show HN, r/webdev, r/selfhosted, r/netsec (security angle), r/SideProject
- [ ] Feedback link
- **Done when:** public, posted, and the README makes an interviewer say "oh, this person gets it."

---

## 14. Resume / README talking points

- Decoupled web + worker; the worker is an egress-only, non-root, read-only container holding the only copy of the secrets key.
- Single URL policy choke point with DNS pinning against SSRF/rebinding; enforced by a custom Semgrep rule.
- Shared zod contract validated on save and on execute; `.strict()` + caps + ReDoS guard.
- Encrypted user secrets, separate DB roles with column-level privileges, redaction in logs.
- Pipeline: SAST (Semgrep, CodeQL), secrets (Gitleaks), SCA (pnpm audit, Trivy, Dependency Review), container scan, signed images (cosign), SBOM per release, DAST (ZAP) nightly.
- Written STRIDE threat model, runbook, disclosure policy, privacy/retention doc.
- Security headers A+, CSP with nonces, rate limiting, audit log, self-service data export/delete.
- Real usage numbers after launch.

---

## 15. If you get stuck

| Symptom | Cause | Fix |
|---|---|---|
| CSP breaks Next hydration | missing nonce on inline script | use middleware to set nonce header + `headers()`; check Next docs "CSP nonce" |
| ZAP flags false positives | default rules | add to `.zap/rules.tsv` as IGNORE with a comment |
| Semgrep rule too noisy | matching tests | exclude `**/*.test.ts` in `.semgrep.yml` |
| undici lookup pin fails on IPv6 | mixed A/AAAA | resolve both, validate all, pass `family: 0` + custom `lookup` that returns only validated IPs |
| BullMQ on Upstash | REST URL | use `rediss://` TCP URL |
| Trivy fails on dev-only CVE | dev dep | `--scanners vuln --ignore-unfixed` + `.trivyignore` with justification + expiry date |
| Fly worker can't reach Neon | TLS | `sslmode=require`, not `verify-full` unless CA configured |
| `compare_last` always "changed" | timestamps/ads | add regex/css narrowing; explain in UI empty state |

---

## 16. V2 backlog
Playwright node (in its **own** sandboxed container/gVisor) · screenshot diff · digests · templates · native Slack/Discord · teams with RBAC · AI summarize node · authenticated ZAP · KMS-backed key management · WAF (Vercel Firewall rules) · bug-bounty-lite via SECURITY.md.
