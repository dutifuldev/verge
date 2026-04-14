---
date: 2026-04-14
title: Local Runtime Workflow
tags: [verge, local, runtime, postgres, seed]
---

# Local Runtime Workflow

This is the recommended way to run the Verge UI, API, worker, and a dedicated local Postgres together on one machine.

The local runtime scripts do three things:

- create and maintain `~/.local/share/verge-local`
- run a dedicated `verge-local-postgres` container on port `55432`
- start the Verge API, worker, and web UI as user `systemd` services

This keeps the local UI stable and keeps Verge's own runtime separate from any other Postgres containers you may already have.

## Commands

From the repo root:

```bash
pnpm local:up
pnpm local:status
pnpm local:seed
pnpm local:reset
pnpm local:down
```

## What Each Command Does

`pnpm local:up`

- writes the runtime env files
- starts the dedicated Postgres container
- runs migrations
- starts `verge-api`, `verge-worker`, and `verge-web`
- syncs repository configuration

`pnpm local:seed`

- waits for the local API
- creates a fresh run for the Verge repo
- creates a fresh run for `verge-testbed` when that checkout exists
- creates a `test-resume` fail-then-resume demo for `verge-testbed`

`pnpm local:reset`

- stops the local services
- deletes the dedicated Verge Postgres container and volume
- clears local artifact storage
- recreates the database
- reruns migrations
- restarts the services
- resyncs configuration

`pnpm local:down`

- stops the local Verge services
- stops the dedicated Postgres container

`pnpm local:status`

- shows the current runtime paths
- prints service status
- prints the local API health response

## Runtime Paths

The local runtime lives under:

```text
~/.local/share/verge-local
```

Important files:

- `toolchain.env`
- `verge.env`
- `webhook_secret.txt`

Important directories:

- `artifacts/`

## Local URLs

By default:

- API: `http://127.0.0.1:8787`
- UI: `http://127.0.0.1:4173`

## Why This Is Better Than Ad Hoc Restarts

The point of the scripts is to make the local instance reproducible.

Without them, the runtime can drift because:

- the API may point at the wrong Postgres
- old services may still be running with stale env
- the UI may be up while the API is broken
- data may mix across unrelated local containers

With the runtime scripts, the local Verge instance has one clear way to boot, reset, and reseed itself.
