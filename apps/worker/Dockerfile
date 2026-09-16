# syntax=docker/dockerfile:1

############################  builder  ############################
FROM node:26-bookworm-slim AS builder
RUN npm install --global pnpm@11.22.0
WORKDIR /repo
ENV CI=true

# prisma generate runs from a postinstall hook and insists a URL exists,
# though it never connects. A dummy keeps a real credential out of the build.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

# Manifests first: Docker caches this layer until a dependency actually
# changes, so edits to source code don't trigger a reinstall.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/flow/package.json packages/flow/
COPY packages/security/package.json packages/security/

# "@watchflow/worker..." means the worker plus the workspace packages it
# depends on. Next.js and the web app never enter this image.
RUN pnpm install --frozen-lockfile --filter "@watchflow/worker..."

COPY apps/worker apps/worker
COPY packages/db/src packages/db/src
COPY packages/flow/src packages/flow/src
COPY packages/security/src packages/security/src

# Second pass drops devDependencies (typescript, tsx, the Prisma CLI) now the
# client is generated. --ignore-scripts so postinstall doesn't run again.
RUN pnpm install --frozen-lockfile --filter "@watchflow/worker..." --prod --ignore-scripts

############################  runtime  ############################
# No shell, no package manager, no utilities: nothing for an attacker who
# reaches code execution to pick up. The image's ENTRYPOINT is `node`, so CMD
# is just the script to run — and Node 26 strips the TypeScript itself.
FROM gcr.io/distroless/nodejs26-debian13:nonroot AS runtime
WORKDIR /repo
COPY --from=builder /repo /repo

# distroless's "nonroot" user. Stated explicitly so a base image change
# can't silently promote this process to root.
USER 65532:65532
ENV NODE_ENV=production

CMD ["apps/worker/src/index.ts"]
