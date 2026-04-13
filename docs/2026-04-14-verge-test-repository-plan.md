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

This is useful for testing noisy behavior, but it is not enough for the main checkpoint demo. A random flake is a bad fit for a reliable resume test because the second run could fail again for unrelated randomness.

### Slow Cases

These should be intentionally long-running:

- tests that sleep for 5 seconds
- tests that sleep for 15 seconds
- tests that sleep for 30 seconds

These should live in explicit slow files or an explicit slow step so Verge can be tested against long execution and partial progress.

### Resume Cases

The repository should include at least one step that is easy to checkpoint and resume:

- a test step with enough individual tests that Verge can complete some processes before resuming the rest

This should be a deterministic fixture, not a random flake.

## Deterministic Resume Fixture

The repository should contain one explicit step for the exact behavior Verge needs to prove:

- the first run should fail partway through
- some individual test processes should already have passed
- the second run should resume from the checkpoint
- the second run should skip the already-passed processes and only run the unfinished or previously failed ones

The clean shape is:

- add a dedicated step such as `test-resume`
- mark that step as `checkpointEnabled: true`
- keep `reuseEnabled: false` so the demo is about checkpoint resume, not cache reuse
- include several individual tests in the step, not one monolithic command

The tests inside that step should behave like this:

- several tests always pass
- one test fails the first time it is executed
- that same test passes on the next execution

The fail-once behavior should be deterministic. It should not depend on random chance.

The simplest implementation is:

- add a small fixture-state directory that is ignored by git
- key that state by the process identity, such as the test process key
- when the fail-once test runs:
  - if its marker file does not exist, create it and fail
  - if its marker file already exists, pass

That gives Verge a stable demo:

1. start the first run without `resumeFromCheckpoint`
2. some test processes pass
3. the fail-once test fails
4. Verge writes a checkpoint with completed and pending process keys
5. start the second run with `resumeFromCheckpoint`
6. Verge reuses the completed processes from the checkpoint
7. Verge only reruns the remaining process or processes
8. the fail-once test now passes because its marker already exists

The fixture should also include a small reset script so this scenario can be reproduced repeatedly on demand.

Recommended reset shape:

- `pnpm fixture:reset-resume`

That script should clear only the deterministic resume markers. It should not wipe unrelated repository state.

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
- `test-resume`
- `test-slow`

Important constraint:

- `test` should remain the normal stable test path
- flaky, resume-demo, and slow behavior should be moved into explicit steps instead of polluting the default baseline

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

The deterministic resume fixture specifically enables a reliable proof that:

- one run can fail partway through
- a later run can resume from that checkpoint
- already-passed test processes are not rerun

## Immediate Next Steps

Before creating the repository, Verge should support multi-repository registration and routing cleanly. After that:

1. Create `dutifulbob/verge-testbed`.
2. Scaffold the repository and its `verge.config.ts`.
3. Add stable, flaky, deterministic-resume, slow, and fail-on-demand tests.
4. Clone it onto the Verge host.
5. Register it with this Verge instance.
6. Add the GitHub webhook.
7. Verify that both repositories appear in the same UI and produce separate runs.
