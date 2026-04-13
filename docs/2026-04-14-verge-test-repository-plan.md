---
date: 2026-04-14
title: Verge Test Repository Plan
tags: [verge, test-repo, fixtures, integration, multi-repository]
---

# Verge Test Repository Plan

## Purpose

Verge needs one external repository that is designed to exercise the control-plane behavior deliberately. This repository is not meant to be realistic product software. It is a fixture repository that gives Verge predictable cases for:

- stable passing work
- deterministic failures
- flaky tests
- long-running tests
- checkpoint and resume behavior
- change-scoped step selection
- multi-repository operation in a single Verge instance

The first external fixture repository should live under `dutifulbob` and be separate from the Verge repo itself.

Suggested repository name:

- `dutifulbob/verge-testbed`

## Core Rule

The test repository should still follow the same product model as any normal repository:

- a `run` is one evaluation for a commit, PR event, or manual trigger
- a `step` is one major check such as `test`, `lint`, or `build`
- a `process` is the smallest meaningful tracked unit inside a step

For tests, each individual test should still be an individual `process`. Flaky or slow behavior should come from the tests themselves or from step membership, not from a different process model.

## Repository Shape

The repository should be small, fast to clone, and easy to reason about. A good initial shape is:

```text
/
  apps/
    api/
    web/
  packages/
    core/
  docs/
  verge.config.ts
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
```

This gives Verge several distinct repo areas while keeping the repository intentionally small.

## Required Scenarios

The repository should contain these deliberate cases.

### Stable Cases

These should pass reliably and form the normal baseline:

- normal unit tests
- normal lint/typecheck/build steps
- basic docs validation

### Deterministic Failure Cases

These should fail on demand in a predictable way:

- one or more tests that fail when an environment variable is enabled
- one build or docs path that can fail when explicitly requested

This is useful for verifying failure handling without introducing randomness.

### Flaky Cases

These should fail intermittently by design:

- tests that fail randomly based on a probability
- tests that alternate pass/fail based on time, seed, or retry count

These should live in explicit flaky files or an explicit flaky step so they are easy to isolate.

### Slow Cases

These should be intentionally long-running:

- tests that sleep for 5 seconds
- tests that sleep for 15 seconds
- tests that sleep for 30 seconds

These should live in explicit slow files or an explicit slow step so Verge can be tested against long execution and partial progress.

### Resume Cases

The repository should include at least one step that is easy to checkpoint and resume:

- a test step with enough individual tests that Verge can complete some processes before resuming the rest

### Change-Scoped Cases

The repository layout should make changed-file scoping obvious:

- `apps/api` changes should clearly map to API-related steps and processes
- `apps/web` changes should clearly map to web-related steps and processes
- `docs` changes should clearly map to docs validation

## Recommended Step Layout

The repository should expose a few normal steps and a few explicit behavior-testing steps.

Recommended steps:

- `lint`
- `typecheck`
- `build`
- `docs-validate`
- `test`
- `test-flaky`
- `test-slow`

Important constraint:

- `test` should remain the normal stable test path
- flaky and slow behavior should be moved into explicit steps instead of polluting the default baseline

That keeps the repository usable while still giving Verge deliberate stress cases.

## Test Conventions

The test repository should use naming that makes intent obvious:

- `*.test.ts` for normal stable tests
- `*.flaky.test.ts` for flaky tests
- `*.slow.test.ts` for slow tests

Examples:

- `apps/api/src/health.test.ts`
- `apps/api/src/retry.flaky.test.ts`
- `apps/web/src/render.slow.test.ts`
- `packages/core/src/config.test.ts`

## Configuration

The repository should contain its own `verge.config.ts`.

That config should:

- define the repository metadata
- define the step specs
- keep the stable and intentionally-chaotic steps separate
- use individual test discovery for the test steps

The test repo should be a normal Verge-managed repository, not a special-case fixture format.

## How It Connects To This Verge Instance

The connection model should be the same as any other repository:

1. The test repo exists on GitHub under `dutifulbob`.
2. The repo is cloned onto the machine running this Verge instance.
3. This Verge instance knows about that checkout and its `verge.config.ts`.
4. GitHub sends repository webhooks to this Verge instance.
5. Verge maps the GitHub repository identity to the correct local checkout and config.
6. Runs for both the Verge repo and the test repo appear in the same UI.

This means the external test repo is not a separate Verge deployment. It is another managed repository inside the same Verge instance.

## UI Expectation

The UI should eventually show both repositories in the same product surface.

That means:

- one Verge instance
- many repositories
- a repository switcher or repository list
- repository-scoped overview, runs, run detail, and step detail pages

The test repository should be visible beside the Verge repository in the same UI.

## Operational Setup

The clean first setup is:

- GitHub repo: `dutifulbob/verge-testbed`
- local checkout on the Verge host
- repository-specific `verge.config.ts`
- GitHub webhook pointed at the existing Verge webhook endpoint

The webhook mechanism should stay normal GitHub webhooks. No special relay is needed beyond whatever public ingress this Verge instance is already using.

## What This Enables

With this repository in place, Verge can be tested against:

- two repositories in one instance
- stable and unstable workloads
- intentionally slow execution
- resume behavior on a non-self-hosted repo
- repository switching in the UI
- repository-specific planning and evidence

## Immediate Next Steps

Before creating the repository, Verge should support multi-repository registration and routing cleanly. After that:

1. Create `dutifulbob/verge-testbed`.
2. Scaffold the repository and its `verge.config.ts`.
3. Add stable, flaky, slow, and fail-on-demand tests.
4. Clone it onto the Verge host.
5. Register it with this Verge instance.
6. Add the GitHub webhook.
7. Verify that both repositories appear in the same UI and produce separate runs.
