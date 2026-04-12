---
date: 2026-04-12
title: Verge MVP Implementation Plan
tags: [verge, ci-cd, mvp, implementation-plan]
---

# Verge MVP Implementation Plan

This document turns the control-plane idea in [Verge CI/CD Control Plane](./verge-ci-cd-control-plane.md) into a practical first implementation plan.

The goal of the MVP is not to build a perfect scheduler or a giant workflow engine. The goal is to prove the core loop:

event in -> plan -> run -> record evidence -> query current repository health

If the first version cannot persist evidence and answer useful health questions from it, then it is only a job runner.

## MVP Goal

The first MVP should let a single repository:

- ingest GitHub push and pull request events
- register a small set of processes
- decide which processes to run for a change
- execute those processes through workers
- record evidence, logs, artifacts, and run lifecycle
- show current run progress and current repository health
- reuse at least one safe cached result
- resume at least one cooperative process from a checkpoint
- run Verge's own processes against the Verge repository itself

## Product Questions The MVP Must Answer

The MVP should be able to answer these queries reliably:

- what processes ran for commit X?
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
- process registry with static process definitions
- Postgres-backed planner and work queue
- worker execution with leases and heartbeats
- process-level evidence for all processes
- subject-level evidence for cooperative process types that can expose subjects
- logs and artifacts in S3-compatible storage
- live run status in an API and dashboard
- one safe cache reuse path
- one cooperative checkpoint/resume path

## Tooling Constraint

The MVP should standardize on VoidZero-aligned frontend and JavaScript tooling wherever that choice is available.

At minimum, the implementation should use:

- Vite for frontend development and build
- Oxlint for linting
- Oxfmt for formatting

Where adjacent tooling choices are needed, prefer the same ecosystem and a minimal toolchain surface over mixing multiple overlapping tools.

This matters for two reasons:

- Verge should dogfood a modern, fast toolchain in its own repository
- the first managed process definitions should exercise those tools directly on the Verge repo

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
- S3-compatible object storage for logs, artifacts, and checkpoints
- worker service for process execution
- Kubernetes Jobs or Deployments for workers
- GitHub App integration for webhook ingestion and commit status updates

The orchestration model should stay simple:

1. GitHub sends an event.
2. The API stores a run request.
3. The planner creates planned process runs.
4. The planner either marks a run as reused or enqueues it.
5. A worker claims queued work using a lease.
6. The worker executes the process and streams heartbeats and progress.
7. The API stores evidence, events, logs, artifacts, and checkpoint metadata.
8. The dashboard and query API read from Postgres.

## Core Domain Model

The MVP should implement the following core records.

### Repository and Process Metadata

- `repositories`
- `process_definitions`
- `process_observed_areas`
- `process_execution_profiles`

### Event and Planning Records

- `event_ingestions`
- `run_requests`
- `planned_runs`
- `planning_decisions`

### Execution Records

- `runs`
- `run_leases`
- `run_heartbeats`
- `run_lifecycle_events`
- `run_logs`
- `run_artifacts`
- `run_checkpoints`

### Evidence Records

- `subjects`
- `observations`
- `observation_events`
- `repo_areas`
- `area_freshness_state`

## Minimum Table Intent

The table names can change, but the MVP must preserve these responsibilities.

`process_definitions`

- stable process key
- display name
- process kind
- execution config
- reuse policy
- checkpoint capability
- declared observed areas

`run_requests`

- source event type
- repository
- commit SHA
- pull request number, if any
- changed files snapshot
- request status

`planned_runs`

- process definition
- run request
- decision reason
- planned action: `run`, `reuse`, `skip`
- evidence target areas

`runs`

- run id
- process definition
- commit SHA
- execution scope hash
- current status
- started/finished timestamps
- reused-from run id, if any

`subjects`

- process definition
- stable subject hash
- canonical subject string
- display label
- subject metadata

`observations`

- run id
- subject id, nullable for process-only evidence
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

1. Accept explicit subject IDs from cooperative adapters.
2. Otherwise derive a canonical string from process kind, config key, path, logical path, title, and parameterization.
3. Hash that canonical string for storage and joins.

For MVP, do not implement aggressive history-repair heuristics. Store enough metadata to add that later.

## Execution Scope Model For MVP

Each observation should record an execution scope separate from subject identity. The initial scope should include:

- commit SHA
- process definition version or config hash
- runtime version
- platform or runner class
- dependency lock hash, if available

This is enough to make reuse decisions auditable.

## Planning Model For MVP

The planner should be deterministic and rule-based.

Inputs:

- event type
- changed files
- process definitions
- observed areas per process
- existing evidence freshness
- reuse policy

Outputs:

- a list of planned runs
- a decision reason for each planned run
- a reuse decision, if applicable

The initial planning rules should be simple:

- always run required baseline processes on pull requests
- run area-specific processes when changed files match observed areas
- reuse a recent compatible result when declared inputs and execution scope still match
- mark untouched areas as still stale or unknown rather than pretending they were validated

Do not attempt probabilistic scheduling in the MVP.

## Worker Protocol For MVP

The worker contract should be explicit and narrow.

Workers must be able to:

- claim a queued planned run using a lease
- start the process with the resolved execution config
- send a heartbeat at a fixed interval
- emit lifecycle events such as `started`, `passed`, `failed`, `timed_out`, `interrupted`
- upload logs and artifact metadata
- emit zero or more subject observations
- publish checkpoint metadata if the process supports it

Workers should not contain planning logic. They execute resolved work and report what happened.

## Reuse Support For MVP

Implement one narrow, auditable reuse path.

Suggested reuse policy:

- process definition explicitly allows reuse
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
- process phase or scenario boundary
- serialized payload location in object storage
- creation timestamp
- resumable-until timestamp

The planner can prefer resume over fresh execution only when:

- the process definition supports checkpoints
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
- `GET /process-definitions`

### Live Updates

- `GET /streams/runs/:id`
- `GET /streams/repositories/:repo/health`

## Dashboard Scope For MVP

The dashboard should prove the model, not try to be a full observability product.

It needs four screens:

- repository overview
- commit or pull request detail
- run detail
- process registry

The repository overview should show:

- current health by area
- stale versus fresh evidence
- active runs
- most recent failures

The commit or pull request detail should show:

- planned runs
- reused versus executed work
- current status
- linked observations and artifacts

The run detail should show:

- lifecycle timeline
- heartbeat freshness
- logs and artifacts
- subject observations, if available
- checkpoint creation and resume information

## Self-Hosting Requirement

The MVP should validate itself by running Verge on the Verge repo.

That means the first supported repository should be this repository, with process definitions that execute Verge's own:

- lint checks
- type checks
- tests
- build
- docs validation

Those processes should be implemented using the chosen VoidZero-oriented toolchain for this repository, with `oxlint` and `oxfmt` as the default lint/format layer and `vite` as the frontend build foundation.

This requirement matters because it forces the product to handle real iteration loops instead of a toy demo path.

The self-hosting bar for MVP should be:

- a commit to the Verge repo triggers Verge
- Verge plans work for the Verge repo
- Verge executes at least one real Verge process through its own worker path
- Verge records the resulting evidence and exposes it in its own UI

## Delivery Phases

### Phase 0: Project Bootstrap

Create the initial monorepo or workspace layout:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/schemas`
- `packages/db`

Bootstrap:

- TypeScript project config
- linting and formatting wired through `oxlint` and `oxfmt`
- Fastify app skeleton
- React + Vite app skeleton
- shared Zod schemas
- Postgres migration setup
- local dev stack with Postgres and S3-compatible storage
- local self-hosting process definitions for the Verge repo

Exit criteria:

- all apps boot locally
- migrations run
- local object storage is reachable
- the repo has working `oxlint`, `oxfmt`, and `vite`-based commands

### Phase 1: Event Ingestion and Process Registry

Implement:

- GitHub webhook receiver
- signature validation
- repository registration
- static process definition storage
- basic run request creation
- initial Verge-on-Verge process definitions

Exit criteria:

- a GitHub push or pull request event creates a stored run request
- process definitions can be listed from the API
- the Verge repository is registered as the first managed repository
- process definitions exist for `oxlint`, `oxfmt` validation, and `vite`-based build validation where relevant

### Phase 2: Planner and Queue

Implement:

- repo areas
- changed-file ingestion
- deterministic planner
- planned runs table
- queueing and lease model
- planning decision records

Exit criteria:

- a run request generates planned runs
- planned runs are marked as `run`, `reuse`, or `skip`
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
- at least one real Verge repo process runs through the worker path

### Phase 4: Evidence Model and Health Queries

Implement:

- process-level observations
- subject-level observations for at least one cooperative process
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

- richer area mapping and subject extraction
- flaky-signal tracking
- broader reuse support across more process types
- multi-repo support
- policy-based planning rules
- more agent-oriented query surfaces

## Summary

The first version of Verge should be a narrow but complete control plane for one repository.

It should ingest change events, plan a small set of processes, execute them through workers, store evidence in a durable model, and expose repository health through a UI and API.

That is enough to validate the core thesis before investing in more advanced scheduling, broader adapters, or heavyweight orchestration.
