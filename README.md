# Watch Flow

## Local development

Secrets are managed with [Doppler](https://doppler.com) — no `.env` file is used.

    doppler login
    doppler setup            # project: watchflow, config: dev
    docker compose up -d
    doppler run -- pnpm dev

`.env.example` lists the required keys.
