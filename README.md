# Watch Flow

## Local development

Secrets are managed with [Doppler](https://doppler.com) — no `.env` file is used.

    doppler login
    doppler setup            # project: watchflow, config: dev
    docker compose up -d
    doppler run -- pnpm dev

`.env.example` lists the required keys.
GITHUB_TOKEN=ghp_R8kQz3mVw7pYt2nLxJ4hB6sD9fG1cA0eU5iO
