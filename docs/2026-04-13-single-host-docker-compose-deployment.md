---
date: 2026-04-13
title: Single-Host Docker Compose Deployment
tags: [verge, deployment, docker-compose, single-host, caddy]
---

# Single-Host Docker Compose Deployment

This is the recommended first real deployment shape for Verge.

It is "monolithic" in the operational sense:

- one machine
- one Docker Compose stack
- one deploy command
- one reverse proxy
- one Postgres instance

It is not a single in-process application binary. The API, worker, and web frontend still run as separate services inside the same stack.

That is the right tradeoff for the current MVP.

## Why This Is The Right First Deployment

The current Verge MVP is simplest on one host because:

- the worker writes artifacts and checkpoints to the local filesystem
- the API and worker are tightly coupled around the current storage model
- the web app is static and easy to serve from the same stack
- GitHub only needs one public HTTPS endpoint

So the recommended first deployment is:

- `postgres`
- `api`
- `worker`
- `web`

The `web` container uses Caddy to:

- terminate HTTPS
- serve the built frontend
- proxy `/api/*` to the Verge API
- proxy `/webhooks/*` to the Verge API

## What The Stack Includes

The repo now includes:

- [Dockerfile](../Dockerfile)
- [infra/deploy/docker-compose.yml](../infra/deploy/docker-compose.yml)
- [infra/deploy/Caddyfile](../infra/deploy/Caddyfile)
- [.env.example](../.env.example)

## Service Shape

### `postgres`

Stores:

- repositories
- run triggers
- runs
- steps and processes
- observations
- events
- checkpoints
- freshness state

### `api`

Handles:

- manual runs
- GitHub webhooks
- planning
- repository health queries
- run detail queries
- worker protocol endpoints

### `worker`

Handles:

- claiming work
- executing concrete processes
- sending events and observations
- writing artifacts and checkpoints

### `web`

Handles:

- serving the built frontend
- reverse proxying API and webhook traffic through Caddy

## Security Model

This deployment is designed to expose only what is necessary.

Publicly exposed:

- HTTPS on the Caddy container

Not publicly exposed:

- Postgres
- the worker
- the API container directly

This means:

- GitHub webhooks hit the Caddy endpoint
- Caddy forwards webhook traffic to the API over the internal Compose network
- Postgres stays private inside the stack
- the worker stays private inside the stack

That is a much better first deployment than opening several separate public ports.

## Step 1: Prepare Environment Variables

Copy the example file:

```bash
cp .env.example .env
```

Then edit `.env` and set:

- `VERGE_DOMAIN`
- `VERGE_ALLOWED_ORIGINS`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `GITHUB_WEBHOOK_SECRET`

Important:

- `VERGE_DOMAIN` should be your real public domain
- `VERGE_ALLOWED_ORIGINS` should usually be `https://<your-domain>`
- `GITHUB_WEBHOOK_SECRET` should be long and random

## Step 2: Point DNS At The Host

Create an `A` or `AAAA` record so your domain points to the server running the stack.

This is required for Caddy to provision HTTPS automatically.

## Step 3: Build And Start The Stack

From the repo root:

```bash
docker compose --env-file .env -f infra/deploy/docker-compose.yml up -d --build
```

This starts:

- Postgres
- the API
- the worker
- the Caddy/web container

## Step 4: Verify The Deployment

Open the site:

```text
https://your-domain
```

Check API health through the proxy:

```bash
curl https://your-domain/api/healthz
```

You should also be able to create a manual run from the UI.

## Step 5: Configure GitHub Webhook

In GitHub, configure the repository webhook to:

```text
https://your-domain/webhooks/github
```

Use:

- content type: `application/json`
- secret: the same `GITHUB_WEBHOOK_SECRET` value from `.env`

The main events to enable are:

- `push`
- `pull_request`

## Operational Notes

### API Routing

The frontend now defaults to `/api` as its API base path.

That means:

- browser requests go to the same public domain
- Caddy strips `/api` and forwards the request to the API container

This keeps browser networking simple and avoids exposing the API directly.

### Artifact Storage

The worker uses `VERGE_STORAGE_ROOT` and writes to a mounted Docker volume.

That means:

- artifacts survive container restarts
- checkpoints survive container restarts
- the current MVP remains single-host friendly

### API Bind Address

The API still defaults to `127.0.0.1` in local development.

Inside Docker Compose, the deployment overrides this with:

```text
HOST=0.0.0.0
```

That is necessary so the Caddy container can reach it over the internal Docker network.

## Updating The Deployment

To rebuild and redeploy:

```bash
git pull
docker compose --env-file .env -f infra/deploy/docker-compose.yml up -d --build
```

## What This Deployment Is Good For

Use this deployment when you want:

- one-box hosting
- minimal infrastructure
- a real public webhook endpoint
- a private internal service network
- an easy path from local testing to hosted use

## What This Deployment Is Not For

This is not the final long-term shape if you want:

- many workers
- multiple hosts
- object storage-backed artifacts
- horizontal scaling
- isolated managed services for each component

For the current MVP, those are later steps.

## Relationship To The Ngrok Setup

The local `ngrok` guide is the easiest way to test Verge against GitHub without exposing your machine directly.

This Docker Compose deployment is the next step when you want:

- a continuously running server
- a real domain
- automatic HTTPS
- one stable public webhook endpoint

See also:

- [2026-04-13-local-ngrok-setup.md](./2026-04-13-local-ngrok-setup.md)

## Summary

The best first hosted deployment for Verge is:

- single host
- Docker Compose
- Caddy in front
- API and worker internal
- Postgres internal
- one persistent artifacts volume

That keeps deployment easy and keeps the exposed attack surface small while matching the current architecture.
