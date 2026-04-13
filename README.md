# Verge

Verge is an evidence-based CI/CD control plane.

Instead of treating CI as a fixed list of workflows that only end in pass or fail, Verge records structured evidence about repository health over time. It decides what to run, what can be reused, what can be resumed, and what parts of a repository are still stale or unknown.

The current MVP runs Verge on the Verge repository itself.

## What Exists Today

The repository currently includes:

- a Fastify API in `apps/api`
- a React + Vite dashboard in `apps/web`
- a long-running worker in `apps/worker`
- shared contracts, planning logic, and persistence packages in `packages/*`
- Postgres-backed persistence via Kysely
- local filesystem-backed artifact and checkpoint storage
- GitHub webhook ingestion
- manual run requests
- process reuse
- checkpoint-based resume for cooperative process specs
- GitHub Actions CI that validates the repo and runs a self-hosted smoke test

## Core Model

The main runtime shape is:

```text
process spec -> run -> process -> observation
```

In plain terms:

- a `process spec` is a reusable recipe like `test` or `build`
- a `run` is one evaluation of one process spec for one trigger
- a `process` is one concrete computation with a stable identity
- an `observation` is the recorded result

## Workspace Layout

```text
apps/
  api/
  web/
  worker/
packages/
  contracts/
  core/
  db/
infra/
  local/
scripts/
docs/
```

## Tooling

This repo is TypeScript-first and uses:

- `pnpm`
- `vite`
- `vitest`
- `oxlint`
- `oxfmt`

## Local Development

### Prerequisites

- Node.js 22+
- `pnpm`
- PostgreSQL

You can use the included Compose file for local Postgres:

```bash
pnpm db:up
pnpm db:migrate
```

By default the local database URL is:

```text
postgres://verge:verge@127.0.0.1:54329/verge
```

### Install

```bash
pnpm install
```

### Run Everything

```bash
pnpm dev
```

This starts:

- the API on `http://127.0.0.1:8787`
- the worker
- the Vite web app

### Useful Commands

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm docs:validate
pnpm test:integration
pnpm test:smoke
```

## Self-Hosting

Verge is intended to validate itself.

The self-hosted process specs currently cover:

- `format-check`
- `lint`
- `typecheck`
- `test`
- `build`
- `docs:validate`

The smoke test boots the API and worker, creates a manual run request against this repo, executes the process specs, and verifies checkpoint-based resume on the `test` process spec.

## CI

GitHub Actions runs the following on pull requests and on `main`:

- formatting
- lint
- typecheck
- docs validation
- build
- unit tests
- DB-backed integration tests
- self-host smoke test

The workflow lives at [.github/workflows/ci.yml](./.github/workflows/ci.yml).

## Storage

The current MVP uses filesystem-backed artifact storage. Logs and checkpoints are written under `.verge-artifacts` by default.

This is a local-development and early-deployment choice. The storage model is intentionally abstract enough to move to object storage later.

## Deployment Shape

The clean deployment shape for the current MVP is:

- one web service for `apps/api`
- one background worker for `apps/worker`
- one static site for `apps/web`
- one Postgres instance
- one persistent storage location for artifacts and checkpoints

The repo also includes a single-host Docker Compose deployment path with Caddy, Postgres, API, worker, and the built web UI:

- [infra/deploy/docker-compose.yml](./infra/deploy/docker-compose.yml)
- [infra/deploy/Caddyfile](./infra/deploy/Caddyfile)
- [.env.example](./.env.example)

## Documentation

Design and planning docs live in `docs/`:

- [2026-04-12-verge-ci-cd-control-plane.md](./docs/2026-04-12-verge-ci-cd-control-plane.md)
- [2026-04-12-verge-basic-objects.md](./docs/2026-04-12-verge-basic-objects.md)
- [2026-04-12-verge-mvp-implementation-plan.md](./docs/2026-04-12-verge-mvp-implementation-plan.md)
- [2026-04-13-local-ngrok-setup.md](./docs/2026-04-13-local-ngrok-setup.md)
- [2026-04-13-single-host-docker-compose-deployment.md](./docs/2026-04-13-single-host-docker-compose-deployment.md)

## Current Status

This is an MVP control plane, not a finished platform. The important thing it proves today is the full loop:

```text
event in -> plan -> run -> record evidence -> query repository health
```
