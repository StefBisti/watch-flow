# Watch Flow

## What it is

Web page / API change monitor. Get notified when anything on the internet changes.

## How to use it

Build a graph flow (fetch -> extract -> compare -> ... -> notify) run it on the server (on a schedule), get notified via email / webhook.

## Where to use it

- Tracking price changes on any website
- Health-checking an API
- Tracking new posts on a blog / website
- Much more

## Local development

Secrets are managed with [Doppler](https://doppler.com), no `.env` file is used.

```bash
  doppler login
  doppler setup            # project: watchflow, config: dev
  docker compose up -d
  doppler run -- pnpm --filter @watchflow/db db:migrate
  docker exec -it watchflow-postgres psql -U watchflow -d watchflow -c "ALTER ROLE wf_web LOGIN PASSWORD 'wf_web_local'" -c "ALTER ROLE wf_worker LOGIN PASSWORD 'wf_worker_local'"
  doppler run -- pnpm dev
```

Each process connects as its own Postgres role: the web app as `wf_web`, the worker as
`wf_worker`, and the Prisma CLI as the table owner (`DIRECT_URL`). The web role can store
secrets but has no `SELECT` on their ciphertext. Grants live in the `add_app_roles` migration.
