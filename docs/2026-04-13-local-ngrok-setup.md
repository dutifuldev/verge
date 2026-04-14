---
date: 2026-04-13
title: Running Verge Locally With Ngrok
tags: [verge, local, ngrok, webhook, deployment, security]
---

# Running Verge Locally With Ngrok

This is the easiest way to run Verge against a real GitHub repository without exposing your machine directly on the public internet.

The basic idea is:

- run Postgres, the Verge API, the Verge worker, and the web UI on one machine
- keep the Verge services bound to localhost
- use `ngrok` only as a narrow HTTPS tunnel for GitHub webhook delivery

This keeps the deployment simple and keeps the exposed surface area small.

If you later want the same one-machine shape running continuously on a server, see [Single-Host Docker Compose Deployment](./2026-04-13-single-host-docker-compose-deployment.md).

## Why This Is The Best First Setup

For the current MVP, Verge is simplest when everything runs on one machine.

That is because:

- the worker writes artifacts and checkpoints to the local filesystem
- the API, worker, and storage model are easiest to reason about together
- GitHub only needs one public HTTPS endpoint for webhook delivery

So the safest and easiest first setup is:

- one machine
- local Postgres
- API on `127.0.0.1:8787`
- worker on the same machine
- web UI on `127.0.0.1:5173`
- `ngrok` forwarding only to the API

## What You Need

- Node.js 22+
- `pnpm`
- Docker and Docker Compose, or another local Postgres setup
- `ngrok`
- a GitHub repository you control

## Recommended Security Rules

Use these rules for the first setup:

- keep Verge bound to `127.0.0.1`, not `0.0.0.0`
- do not set `VERGE_ALLOW_UNVERIFIED_GITHUB_WEBHOOKS=1`
- always configure a real `GITHUB_WEBHOOK_SECRET`
- use a test repository first, not your most sensitive production repo
- run the worker and API as your normal user, not as root
- keep Postgres credentials local and specific to Verge
- rotate the webhook secret if you accidentally leak it
- stop the `ngrok` tunnel when you are not testing

The key idea is:

- your machine is still private
- only the webhook tunnel is public
- GitHub can only reach what `ngrok` forwards

## Step 1: Install Dependencies

From the repo root:

```bash
pnpm install
```

## Step 2: Start The Local Runtime

The clean way now is:

```bash
pnpm local:up
pnpm local:seed
```

That creates the local runtime env, starts the dedicated Verge Postgres, starts the API, worker, and web UI, and seeds fresh data for `verge` and `verge-testbed`.

Expected local URLs:

- API: `http://127.0.0.1:8787`
- UI: `http://127.0.0.1:4173`

## Step 3: Verify Local Operation Before GitHub

Before you involve GitHub, make sure Verge works locally.

Check API health:

```bash
curl http://127.0.0.1:8787/healthz
```

Open the UI:

```text
http://127.0.0.1:4173
```

The seeded runs should already be visible in the UI.

## Step 4: Start Ngrok

Point `ngrok` at the local Verge API:

```bash
ngrok http 127.0.0.1:8787
```

`ngrok` will give you a public HTTPS URL like:

```text
https://example-id.ngrok-free.app
```

You will use this only for GitHub webhook delivery.

The webhook URL should be:

```text
https://example-id.ngrok-free.app/webhooks/github
```

## Step 5: Configure GitHub Webhook

In the GitHub repository you want Verge to observe:

1. Go to `Settings -> Webhooks`
2. Add a webhook
3. Use:
   - Payload URL: `https://example-id.ngrok-free.app/webhooks/github`
   - Content type: `application/json`
   - Secret: the exact value of `GITHUB_WEBHOOK_SECRET`
4. Select the events you want to send

For the current MVP, the important events are:

- `push`
- `pull_request`

## Step 6: Test Webhook Delivery

Use GitHub's webhook delivery tester or push a small commit.

What should happen:

1. GitHub sends the webhook to the `ngrok` URL
2. `ngrok` forwards it to `127.0.0.1:8787`
3. Verge validates the webhook signature
4. Verge creates a run
5. the worker claims the work
6. the UI shows the run and repository health

## What To Expose And What Not To Expose

For this setup:

- expose only the `ngrok` URL
- keep Postgres private
- keep the UI local
- keep the worker local
- keep the API bound to localhost

You do not need to expose:

- SSH
- Postgres
- the Vite web UI
- the worker

The only public path you need for webhook testing is:

```text
/webhooks/github
```

## Practical Notes

### The UI Does Not Need To Be Public

You can keep using the UI locally at `http://127.0.0.1:5173`.

GitHub only needs to reach the webhook endpoint.

### The API Can Stay On Localhost

Because `ngrok` runs on the same machine and forwards into localhost, the API does not need to bind to `0.0.0.0`.

That is better for security.

### The Worker Should Stay On The Same Machine

Right now the worker writes logs and checkpoints to the local filesystem.

So for the easiest and safest first setup:

- keep API and worker on the same machine
- keep storage local

### Use A Test Repository First

Use a repo where it is safe to send repeated push and PR events while you are still learning the system.

## Recommended First Test Flow

This is the cleanest order:

1. `pnpm install`
2. `pnpm db:up`
3. `pnpm db:migrate`
4. export `DATABASE_URL`, `GITHUB_WEBHOOK_SECRET`, and `VERGE_ALLOWED_ORIGINS`
5. `pnpm dev`
6. verify `http://127.0.0.1:8787/healthz`
7. create a manual run locally
8. start `ngrok http 127.0.0.1:8787`
9. configure GitHub webhook to `https://<ngrok-url>/webhooks/github`
10. push a commit or update a PR
11. watch the run in the local UI

## When To Move Beyond This Setup

This setup is right for:

- first real end-to-end testing
- webhook validation
- dogfooding Verge on one machine

You should move beyond it when:

- you want Verge to stay up continuously
- you want other people to use the UI
- you want persistent managed infrastructure
- you want object storage instead of local disk
- you want multiple workers

At that point, a small hosted deployment with a real domain and managed Postgres makes more sense.

## Summary

The easiest secure setup today is:

- run Verge locally
- keep everything on one machine
- keep services private on localhost
- use `ngrok` only for GitHub webhook delivery

That gives you real GitHub integration with very little infrastructure and a much smaller public attack surface than exposing the whole app directly.
