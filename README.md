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

Secrets are managed with [Doppler](https://doppler.com) — no `.env` file is used.

    doppler login
    doppler setup            # project: watchflow, config: dev
    docker compose up -d
    doppler run -- pnpm dev

`.env.example` lists the required keys.
