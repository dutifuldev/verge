---
date: 2026-04-12
title: Verge MVP Implementation Plan
tags: [verge, ci-cd, mvp, implementation-plan]
---

# Verge MVP Implementation Plan

This document turns the control-plane idea in [Verge CI/CD Control Plane](./2026-04-12-verge-ci-cd-control-plane.md) into a practical first implementation plan.

The goal of the MVP is not to build a perfect scheduler or a giant workflow engine. The goal is to prove the core loop:

event in -> plan -> run -> record evidence -> query current repository health

If the first version cannot persist evidence and answer useful health questions from it, then it is only a job runner.

## Public Terminology

The intended public runtime model is:

```text
run -> step -> process -> observation
```

In plain terms:

- a `run` is one commit-level, PR-level, or manual evaluation
- a `step` is a major check inside a run, like `build`, `test`, or `lint`
- a `process` is a smaller concrete computation inside a step, like `api`, `web`, or a shard
- an `observation` is the recorded result

Some current implementation details still use older internal names such as `run_request`, `run`, and `process_spec`. This plan keeps those names where it is talking about current tables or endpoints, but the public product model above is the one Verge should present.

## MVP Goal

The first MVP should let a single repository:

- ingest GitHub push and pull request events
- register a small set of steps and processes
- decide which steps and processes to run for a change
- execute those steps and processes through workers
- record evidence, logs, artifacts, and run lifecycle
- show current run progress and current repository health
- reuse at least one safe cached result
- resume at least one cooperative process from a checkpoint
- run Verge's own processes against the Verge repository itself

## Product Questions The MVP Must Answer

The MVP should be able to answer these queries reliably:

- what steps and processes ran for commit X?
- what is still running right now?
- what repo areas were observed by the latest runs?
- what evidence is fresh, stale, unknown, or failed?
- what work was reused instead of rerun?
- what evidence exists for this pull request?

If a proposed feature does not materially improve one of those answers, it should probably wait.

## Scope

### In Scope

- single-repository support
- self-hosting on the Verge repository as the primary test target
- GitHub App webhook ingestion
- static step registry
- Postgres-backed planner and work queue
- worker execution with leases and heartbeats
- process-level evidence for all processes
- optional finer-grained evidence for cooperative process types when needed
- logs and artifacts in an object storage abstraction
- live run status in an API and dashboard
- one safe cache reuse path
- one cooperative checkpoint/resume path

## Tooling Constraint

The MVP should standardize on VoidZero-aligned frontend and JavaScript tooling wherever that choice is available.

At minimum, the implementation should use:

- `pnpm` workspaces for package management
- Vite for frontend development and build
- Oxlint for linting
- Oxfmt for formatting

Where adjacent tooling choices are needed, prefer the same ecosystem and a minimal toolchain surface over mixing multiple overlapping tools.

This matters for two reasons:

- Verge should dogfood a modern, fast toolchain in its own repository
- the first managed steps should exercise those tools directly on the Verge repo

All application code should be written in valid TypeScript. Plain `.js` application files should not be introduced.

## UI Design Constraint

UI and visual design work should use the Impeccable skill set from https://impeccable.style/ as the default design guidance layer.

This should be used for:

- page and dashboard design
- typography and spacing decisions
- layout refinement
- visual polish and anti-pattern review

For Verge, this means frontend implementation should not stop at functional correctness. UI work should be reviewed and refined through the Impeccable workflow before it is treated as complete.

## Local Storage Decision

The MVP should keep object storage as an explicit product concept, but local development should not depend on a separately running S3-compatible service.

The initial approach should be:

- define a storage interface for logs, artifacts, and checkpoints
- use a filesystem-backed adapter for local development and early MVP work
- preserve object-store-style semantics in the metadata model
- add a real S3-compatible adapter later without changing the domain model

This keeps Phase 0 simple while still designing the system around durable artifact storage from the start.

## Repository Layout Decision

The repo should use a small `pnpm` workspace with a strict separation between deployable apps, shared packages, infrastructure assets, and docs.

The package setup should follow the same broad shape as `../openclaw-1`:

- a root workspace package for orchestration scripts and shared config
- `apps/*` for deployable services
- `packages/*` for reusable libraries
- no feature code living at the repository root

The initial layout should be:

```text
/
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
    k8s/
  scripts/
  docs/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
```

Layout rules:

- `apps/` contains only deployable services
- `packages/` contains shared TypeScript libraries with no deployment-specific concerns
- `infra/local/` contains local development infrastructure such as Compose files and seed helpers
- `infra/k8s/` contains deployment manifests or Helm/Kustomize material when Kubernetes support is added
- `scripts/` contains small repository automation scripts only
- the repository root should hold workspace-level config, not feature code
- the root `package.json` should act as a workspace orchestrator, not as the main application package
- `pnpm-workspace.yaml` should include `.`, `apps/*`, and `packages/*`

## Package Responsibilities

The first workspace packages should have these responsibilities:

`apps/api`

- Fastify control-plane API
- webhook ingestion
- run planning orchestration
- SSE endpoints
- GitHub integration

`apps/web`

- React + Vite dashboard
- repository health views
- run detail views
- live updates

`apps/worker`

- process execution
- lease claiming
- heartbeat and observation emission
- log and artifact reporting

`packages/contracts`

- shared Zod schemas
- API request and response contracts
- worker protocol payloads
- event payload schemas

`packages/core`

- domain types that are not transport-specific
- planning rules
- evidence and freshness logic
- step and process helpers
- fingerprinting and reuse decision helpers

`packages/db`

- Kysely database types
- migrations
- query helpers
- transaction boundaries for core persistence paths

The first storage adapter should be filesystem-backed for local development. A real S3-compatible adapter should be added after the core persistence and query paths are stable.

This is intentionally small. New packages should only be added when a dependency direction problem appears, not preemptively.

## Pinned Bootstrap Decisions

The following decisions should be treated as fixed for the first implementation pass.

### Workspace Setup

- package manager: `pnpm`
- workspace shape: root package plus `apps/*` and `packages/*`
- root package responsibility: shared scripts, dependency policy, and workspace-level config only
- root workspace file:

```yaml
packages:
  - .
  - apps/*
  - packages/*
```

- root TypeScript config: `tsconfig.base.json`
- root test config: `vitest.config.ts`
- package naming convention:
  - `@verge/api`
  - `@verge/web`
  - `@verge/worker`
  - `@verge/contracts`
  - `@verge/core`
  - `@verge/db`

### Execution and Runtime

- Phase 0 and Phase 1 worker execution target: local subprocess runner
- Kubernetes execution remains a later deployment target, not the first bootstrap path
- initial event ingestion order:
  1. manual runs
  2. GitHub webhook ingestion

### Testing and Validation

- unit and integration test runner: `vitest`
- docs validation: lightweight frontmatter and link validation, not a heavyweight docs toolchain
- formatting: `oxfmt`
- linting: `oxlint`

### Step Materialization

- Verge should provide a generic step and process materialization model in TypeScript for all projects that use the library
- each project should define its own concrete processes in TypeScript config
- the default result should be a small set of named processes with stable keys
- finer sharding should happen inside a process only when a process becomes too large
- the initial materialization kinds should be:
  - `singleProcess`
  - `namedProcesses`
  - `fixedShards`
- the first test materialization strategy should be named processes mapped to clear repo areas or projects such as `api`, `web`, `worker`, or `packages`
- raw glob-heavy process selection should not be the primary long-term API

### Local Infrastructure

- local infrastructure tool: `docker compose`
- local services for Phase 0: Postgres only
- artifact and checkpoint storage in local development: filesystem-backed storage adapter

### Database

- query builder and migrations: Kysely in `packages/db`
- schema changes should be migration-driven from the first commit

### Root Scripts

The root package should expose these workspace-level scripts:

- `dev`
- `build`
- `lint`
- `format`
- `format:check`
- `typecheck`
- `test`
- `docs:validate`

The first implementation may add narrower scripts such as `dev:api` or `test:watch`, but the commands above should exist from the start.

### Out of Scope

- general multi-repo tenancy
- sophisticated information-gain scheduling
- universal checkpointing for arbitrary scripts
- full flaky-signal scoring
- deep historical identity repair
- replacing test runners or build tools
- Temporal or another heavyweight workflow engine

## Suggested Initial Process Set

The first MVP should start with a tiny process catalog. Choose processes that exercise the model without requiring too much adapter complexity.

Suggested initial processes:

- `lint`
- `unit-tests`
- `build`
- `docs-validate`

Suggested cooperative process for checkpoint support:

- `e2e-smoke` or another scenario-based process that can emit scenario-level progress and resume from explicit phase boundaries

For the first real proving ground, these processes should run on the Verge repository itself. The system should dogfood its own control plane instead of relying on a separate sample repository.

For the Verge repo specifically, the initial process set should map to real project commands built around the selected toolchain, including `oxlint`, `oxfmt`, and `vite`-backed build and dev validation where applicable.

## High-Level Architecture

The first implementation should use a boring control-plane architecture:

- React + Vite dashboard
- Fastify API
- Postgres as source of truth
- an object storage abstraction for logs, artifacts, and checkpoints
- worker service for process execution
- Kubernetes Jobs or Deployments for workers
- GitHub App integration for webhook ingestion and commit status updates

The orchestration model should stay simple:

1. GitHub sends an event.
2. The API stores a top-level run trigger record.
3. The planner creates the steps and concrete processes for that run.
4. The planner either marks a step as reused or enqueues it.
5. A worker claims queued work using a lease.
6. The worker executes the process and streams heartbeats and progress.
7. The API stores evidence, events, logs, artifacts, and checkpoint metadata.
8. The dashboard and query API read from Postgres.

## Core Domain Model

The MVP should implement the following core records.

### Repository, Step, and Process Metadata

- `repositories`
- `process_specs`
- `processes`
- `process_observed_areas`
- `process_execution_profiles`

### Event and Planning Records

- `event_ingestions`
- `run_requests`
- `planned_runs`
- `planning_decisions`

### Execution Records

- `runs`
- `run_processes`
- `run_leases`
- `run_heartbeats`
- `run_lifecycle_events`
- `run_logs`
- `run_artifacts`
- `run_checkpoints`

### Evidence Records

- `observations`
- `observation_events`
- `repo_areas`
- `area_freshness_state`

## Minimum Table Intent

The table names can change, but the MVP must preserve these responsibilities.

The public naming should stay `run -> step -> process -> observation`. The table names below are current implementation-oriented names.

`process_specs`

- stable step key
- display name
- step kind
- execution config
- reuse policy
- checkpoint capability
- declared observed areas

`processes`

- step definition
- stable process key
- display label
- process metadata

`run_requests`

- source event type
- repository
- commit SHA
- pull request number, if any
- changed files snapshot
- request status

Publicly, this is the top-level run trigger record.

`planned_runs`

- step
- top-level run trigger
- decision reason
- planned action: `run`, `reuse`, `skip`
- evidence target areas

`runs`

- run id
- step
- commit SHA
- execution scope hash
- current status
- started/finished timestamps
- reused-from run id, if any

`run_processes`

- run id
- process key
- process label
- process type
- status
- selection payload
- started/finished timestamps
- attempt count

`observations`

- run id
- process key, nullable for run-level evidence
- execution scope fields
- status
- observed at
- summary payload

`area_freshness_state`

- repo area
- last observed at
- last successful observation at
- freshness bucket
- latest status

## Identity Model For MVP

The MVP should not wait for a perfect identity system. Implement the minimum durable version:

1. Accept explicit stable process IDs from cooperative adapters.
2. Otherwise derive a canonical string from step kind, config key, path, logical path, title, and parameterization.
3. Hash that canonical string for storage and joins.

For MVP, do not implement aggressive history-repair heuristics. Store enough metadata to add that later.

## Execution Scope Model For MVP

Each observation should record an execution scope separate from process identity. The initial scope should include:

- commit SHA
- step version or config hash
- runtime version
- platform or runner class
- dependency lock hash, if available

This is enough to make reuse decisions auditable.

## Planning Model For MVP

The planner should be deterministic and rule-based.

Inputs:

- event type
- changed files
- step definitions
- observed areas per process
- existing evidence freshness
- reuse policy

Outputs:

- a top-level run plus its planned steps
- the processes inside each planned step, when the step materializes more than one process
- a decision reason for each planned step
- a reuse decision, if applicable

The initial planning rules should be simple:

- always run required baseline processes on pull requests
- run area-specific processes when changed files match observed areas
- reuse a recent compatible result when declared inputs and execution scope still match
- mark untouched areas as still stale or unknown rather than pretending they were validated

Do not attempt probabilistic scheduling in the MVP.

## Step And Process Materialization Model For MVP

Verge should use a simple runtime model:

run -> step -> process -> observation

A step is a major check inside the run. A process is one standalone computation inside that step with a stable ID.

The library should provide the generic materialization mechanism. Each project should provide the actual step and process materialization rules in TypeScript.

That means:

- Verge defines materialization kinds and process lifecycle rules
- a repository defines its own process names and boundaries in TypeScript
- the planner materializes concrete steps and processes from those definitions for each run

For MVP, the supported materialization kinds should be:

- `singleProcess`
- `namedProcesses`
- `fixedShards`

The preferred default is `namedProcesses`.

For tests, that means a project should define a small number of stable processes such as:

- `api`
- `web`
- `worker`
- `packages`

Each process should map to a clear repo area, package, or test project. Verge should run those processes separately.

If one process becomes too large, Verge may shard inside that process later. It should not start by inventing complex splits from arbitrary shell commands.

This is important for checkpointing. Checkpoints should record which processes finished, failed, or remain pending. In practice, that means Verge checkpoints completed processes, not raw process memory.

## Worker Protocol For MVP

The worker contract should be explicit and narrow.

Workers must be able to:

- claim queued work using a lease
- start the process with the resolved execution config
- send a heartbeat at a fixed interval
- emit lifecycle events such as `started`, `passed`, `failed`, `timed_out`, `interrupted`
- upload logs and artifact metadata
- emit zero or more process observations
- publish checkpoint metadata if the process supports it

Workers should not contain planning logic. They execute resolved work and report what happened.

## Reuse Support For MVP

Implement one narrow, auditable reuse path.

Suggested reuse policy:

- the step explicitly allows reuse
- execution scope hash matches
- declared input fingerprint matches
- prior run status is successful
- prior result age is within a configured freshness window

When reuse happens, Verge should still create a run record for the current request. It should be marked as reused and linked to the source run so the decision is visible in the UI and API.

## Checkpoint Support For MVP

Implement checkpointing only for a cooperative process type.

The initial checkpoint contract should include:

- checkpoint key
- run id
- completed process keys
- pending process keys
- serialized payload location in object storage
- creation timestamp
- resumable-until timestamp

The planner can prefer resume over fresh execution only when:

- the step supports checkpoints
- the checkpoint is still valid
- the input fingerprint still matches the resumable boundary rules

Do not try to snapshot arbitrary shell state.

## API Surface For MVP

The Fastify API should expose a small control-plane surface.

### Ingestion

- `POST /webhooks/github`
- `POST /run-requests/manual`

### Planning and Execution

- `GET /run-requests/:id`
- `GET /runs/:id`
- `GET /runs/:id/processes`
- `GET /runs/:id/events`
- `POST /workers/claim`
- `POST /workers/:runId/heartbeat`
- `POST /workers/:runId/events`
- `POST /workers/:runId/observations`
- `POST /workers/:runId/artifacts`
- `POST /workers/:runId/checkpoints`

### Query

- `GET /repositories/:repo/health`
- `GET /repositories/:repo/areas`
- `GET /repositories/:repo/commits/:sha`
- `GET /repositories/:repo/pull-requests/:number`
- `GET /process-specs`

These endpoint names can stay implementation-oriented for MVP even though the public model should be described as runs, steps, and processes.

### Live Updates

- `GET /streams/runs/:id`
- `GET /streams/repositories/:repo/health`

## Dashboard Scope For MVP

The dashboard should prove the model, not try to be a full observability product.

It needs four screens:

- repository overview
- commit or pull request detail
- run detail
- step registry

The repository overview should show:

- current health by area
- stale versus fresh evidence
- active runs
- most recent failures

The commit or pull request detail should show:

- the run and its planned steps
- reused versus executed work
- current status
- linked observations and artifacts

The run detail should show:

- lifecycle timeline
- heartbeat freshness
- process status
- logs and artifacts
- process observations, if available
- checkpoint creation and resume information

## Self-Hosting Requirement

The MVP should validate itself by running Verge on the Verge repo.

That means the first supported repository should be this repository, with steps that execute Verge's own:

- lint checks
- type checks
- tests
- build
- docs validation

Those steps should be implemented using the chosen VoidZero-oriented toolchain for this repository, with `oxlint` and `oxfmt` as the default lint/format layer and `vite` as the frontend build foundation.

This requirement matters because it forces the product to handle real iteration loops instead of a toy demo path.

The self-hosting bar for MVP should be:

- a commit to the Verge repo triggers Verge
- Verge plans work for the Verge repo
- Verge executes at least one real Verge step through its own worker path
- Verge records the resulting evidence and exposes it in its own UI

## Delivery Phases

### Phase 0: Project Bootstrap

Create the initial monorepo or workspace layout:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/contracts`
- `packages/core`
- `packages/db`
- `infra/local`
- `infra/k8s`
- `scripts`

Bootstrap:

- `pnpm-workspace.yaml`
- root `package.json` for workspace scripts only
- shared `tsconfig.base.json`
- TypeScript project config
- linting and formatting wired through `oxlint` and `oxfmt`
- Fastify app skeleton
- React + Vite app skeleton
- worker app skeleton
- shared contracts package
- shared core package
- Postgres migration setup
- local dev stack with Postgres
- filesystem-backed local artifact and checkpoint storage
- local self-hosting steps for the Verge repo

Exit criteria:

- all apps boot locally
- migrations run
- local artifact and checkpoint storage is reachable through the storage interface
- the repo has working `oxlint`, `oxfmt`, and `vite`-based commands
- the workspace dependency graph is clean, with shared logic living in `packages/` instead of cross-importing between apps

### Phase 1: Event Ingestion and Step Registry

Implement:

- GitHub webhook receiver
- signature validation
- repository registration
- static step storage
- basic top-level run creation
- initial Verge-on-Verge steps

Exit criteria:

- a GitHub push or pull request event creates a stored top-level run record
- step definitions can be listed from the API
- the Verge repository is registered as the first managed repository
- step definitions exist for `oxlint`, `oxfmt` validation, and `vite`-based build validation where relevant

### Phase 2: Planner and Queue

Implement:

- repo areas
- changed-file ingestion
- deterministic planner
- planned step records
- queueing and lease model
- planning decision records

Exit criteria:

- a top-level run generates planned steps
- planned steps are marked as `run`, `reuse`, or `skip`
- workers can claim queued work safely

### Phase 3: Worker Execution and Run Lifecycle

Implement:

- worker claim endpoint
- heartbeats
- lifecycle events
- status transitions
- stdout and stderr capture
- artifact upload metadata

Exit criteria:

- a worker can execute a real process end to end
- run state is visible through the API
- lease expiry and stale heartbeat detection work
- at least one real Verge repo step runs through the worker path

### Phase 4: Evidence Model and Health Queries

Implement:

- process-level observations
- optional finer-grained observations for at least one cooperative process
- area freshness rollups
- repository health queries
- commit and pull request detail queries

Exit criteria:

- the system can answer what was observed for a commit
- the system can show stale, fresh, failed, and unknown areas

### Phase 5: Dashboard

Implement:

- repository overview page
- commit or pull request detail page
- run detail page
- SSE-driven live updates

Exit criteria:

- users can watch a run progress live
- users can inspect current health and evidence history without looking at raw database rows
- users can inspect a real Verge-on-Verge run from the dashboard

### Phase 6: Reuse

Implement:

- input fingerprinting for one process family
- compatible-run lookup
- reused run records
- UI and API visibility for reuse decisions

Exit criteria:

- the planner can safely reuse one prior result
- the dashboard clearly shows reused versus freshly executed work

### Phase 7: Checkpointing

Implement:

- cooperative checkpoint contract
- checkpoint storage metadata
- resume-aware planning for one process type
- resume visibility in run detail

Exit criteria:

- one cooperative process can resume from a saved checkpoint
- resume decisions are auditable

## Suggested Engineering Order

The recommended order is:

1. bootstrap
2. event ingestion
3. planner and queue
4. worker execution
5. evidence model
6. health queries
7. dashboard
8. reuse
9. checkpointing

This order matters because the product value comes from stored state and queryable evidence, not from advanced scheduling tricks.

## Testing Strategy For MVP

The MVP should be validated in layers, from local developer checks to full self-hosting.

### 1. Workspace Checks

The repository itself should have working root commands for:

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

These are the baseline health checks for the Verge repo and should stay green before higher-level validation is trusted.

### 2. Core Unit Tests

Unit tests should cover the core logic directly, without requiring the full control plane to run.

At minimum, cover:

- process materialization rules
- planning rules
- reuse decisions
- checkpoint resume decisions
- repo area rollups

### 3. API Integration Tests

Integration tests should run against a real local Postgres instance and verify the main control-plane write paths.

At minimum, cover:

- creating a manual run
- creating step runs from step definitions
- claiming work
- recording observations
- updating repo area state

### 4. Worker Integration Tests

Worker integration tests should execute real local commands through the worker path.

For Verge, the first commands should include:

- `oxlint`
- `oxfmt --check`
- `vitest`
- `vite build`, where relevant

### 5. End-to-End Self-Hosting Tests

The most important end-to-end test is Verge running on the Verge repository itself.

That means:

- create a run for the current Verge repo state
- materialize real Verge steps such as `lint`, `test`, `build`, and `docs:validate`
- execute them through the normal worker path
- persist observations, artifacts, and health state
- expose the results through the API and dashboard

### 6. Reuse and Resume Tests

After the basic self-hosting path works, verify:

- safe reuse on repeated requests with matching inputs
- resume from a saved checkpoint for one cooperative process type
- only unfinished processes continue after resume

The acceptance bar is not just that commands ran. The acceptance bar is that Verge decided what to run, executed it, stored what it learned, and exposed that state back through its own interfaces.

## Acceptance Criteria For MVP

The MVP is done when a user can:

1. connect one GitHub repository
2. use the Verge repository itself as that repository
3. receive a pull request event
4. see Verge plan a small set of Verge repo processes
5. watch at least one real Verge repo process execute live
6. inspect logs, artifacts, and observations
7. see repository areas marked fresh, stale, failed, or unknown
8. see one run reused safely
9. see one cooperative process resumed from a checkpoint

## Operational Requirements

The MVP should also include a minimal but real operational baseline:

- structured logs
- OpenTelemetry traces for API and worker flows
- idempotent webhook ingestion
- retry-safe worker event writes
- lease expiry recovery
- object storage key conventions
- migration-based schema management

Without these, debugging the control plane will be harder than building it.

## Risks and Mitigations

### Risk: the team builds a job runner, not an evidence system

Mitigation:

- force every run to produce stored observations
- make repository health queries a first-class deliverable

### Risk: identity modeling stalls delivery

Mitigation:

- start with explicit IDs and deterministic derived IDs
- defer history-repair heuristics

### Risk: checkpointing expands uncontrollably

Mitigation:

- support one cooperative process only
- require explicit boundaries and payloads

### Risk: planning becomes too clever too early

Mitigation:

- keep the planner rule-based in v1
- store decision reasons so the behavior is explainable

## First Post-MVP Priorities

After the MVP works, the next useful expansions are:

- richer area mapping and deeper process extraction
- flaky-signal tracking
- broader reuse support across more process types
- multi-repo support
- policy-based planning rules
- more agent-oriented query surfaces

## Summary

The first version of Verge should be a narrow but complete control plane for one repository.

It should ingest change events, plan a small set of processes, execute them through workers, store evidence in a durable model, and expose repository health through a UI and API.

That is enough to validate the core thesis before investing in more advanced scheduling, broader adapters, or heavyweight orchestration.
