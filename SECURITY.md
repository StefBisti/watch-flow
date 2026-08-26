# Security Policy

WatchFlow is a personal project, but it handles user credentials and fetches
attacker-influenced URLs, so reports are taken seriously.

## Reporting a vulnerability

Use **[Private vulnerability reporting](https://github.com/StefBisti/watch-flow/security/advisories/new)**.
Please do not open a public issue for a security bug.

Include: what you found, how to reproduce it, and what an attacker could do with it.

## What to expect

|                        |                                                      |
| ---------------------- | ---------------------------------------------------- |
| Acknowledgement        | within 3 days                                        |
| Initial assessment     | within 7 days                                        |
| Fix or mitigation plan | within 30 days                                       |
| Public disclosure      | 90 days after report, or on fix — whichever is first |

## In scope

- SSRF or DNS rebinding past `packages/security/urlPolicy`
- Reading or modifying another user's watches, runs, or secrets (IDOR)
- Exposure of `WatchSecret` plaintext, in logs, responses, or errors
- Authentication or session flaws
- RCE or injection in the flow engine or worker
- Using WatchFlow to attack third parties (abuse of the fetch/webhook nodes)

## Out of scope

- Findings from automated scanners with no demonstrated impact
- Missing headers on endpoints that serve no sensitive content
- Denial of service through sheer volume
- Social engineering, physical access, or third-party services

## Safe harbour

Testing against your own account is welcome. Do not access other users' data,
degrade the service, or run automated scans at volume. Report promptly and give
us the disclosure window above, and we won't pursue any action.

## Credit

Reporters are credited in the release notes for the fix, unless you'd rather not be.
