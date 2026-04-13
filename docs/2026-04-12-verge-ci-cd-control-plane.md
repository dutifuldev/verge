---
date: 2026-04-12
author: Onur Solmaz <onur@solmaz.io>
title: Verge CI/CD Control Plane
tags: [verge, ci-cd, control-plane, evidence]
---

# Verge

Verge is an evidence-based CI/CD control plane.

The main idea is simple: CI should stop acting like a fixed list of workflows that only produce green or red badges. Instead, CI should collect structured evidence about repository health over time, decide what work matters next, and let both humans and agents query that state.

## What Verge Is

Verge sits above normal tools like test runners, compilers, linters, release scripts, and agent workflows.

Those tools still do the actual work. Verge decides:

- what steps should run
- what processes should exist inside those steps
- why they should run
- what each run observed
- what can be reused
- what is stale, unknown, or risky
- what should run next

This makes Verge broader than a testing framework and broader than test optimization alone.

## The Core Shift

Traditional CI asks:

- did this workflow pass?

Verge asks:

- what did this run teach us?
- what parts of the repository are well observed right now?
- what parts are stale or dark?
- what is the fastest next step or process that increases confidence?

Each run is treated as a partial observation, not a final verdict.

## Why This Exists

This matters more as commit volume and contribution volume go up, especially with AI agents.

In that world:

- not every process can run on every commit
- many processes are expensive or noisy
- some processes are much more useful than others for a given change
- rerunning everything from scratch wastes time and money
- pass/fail alone is too weak as a model of repository health

Verge exists to optimize for fast signal, growing confidence, and eventual coverage over time.

## What Counts As a Step

A step is a major check inside a run.

Examples:

- `build`
- `test`
- `lint`
- `typecheck`
- `docs:validate`

A run will usually contain a small number of steps like these.

## What Counts As a Process

A process is one standalone computation that reveals something about the state of the repository.

Examples:

- one test case
- one stable test group such as `api`
- one build target
- one smoke-test scenario
- one benchmark case
- one documentation validation pass
- one agent investigation unit

Higher-level things like `test`, `build`, or `docs:validate` are better thought of as steps. A process is the concrete computation inside a step that gets a stable identity and can actually run.

## What Counts As Evidence

Evidence means the actual information produced by a run.

Examples:

- this build succeeded on commit X
- these tests passed for area Y
- this process observed package Z recently
- this area has not been observed in six days
- this signal is weak because the process is flaky
- this commit has only partial coverage so far

A workflow status is only a summary. Evidence is the useful part underneath it.

## Conceptual Model

Verge models a repository as:

- important areas or surfaces
- runs
- steps inside those runs
- concrete processes inside those steps
- a live state made from accumulated evidence over time

From that model, Verge should be able to answer:

- what do we currently know about repository health?
- what is stale, dark, uncertain, or risky?
- what validation has already happened for this commit?
- what work can be skipped, reused, resumed, or rerun?
- what should run next for the highest information gain?

## Information Flow

The main information flow looks like this:

1. A commit, pull request event, manual request, or agent request comes in.
2. The planner looks at the change, the step metadata, and the current evidence state.
3. Verge decides which steps matter now and which concrete processes should exist inside each step.
4. Before starting each step, Verge checks whether it can reuse a past result, resume from a checkpoint, or must start fresh.
5. While work runs, the runner streams heartbeats, logs, progress, artifacts, and any new checkpoints.
6. Verge stores that information and updates the live model of repository health.
7. The next run uses that stored state to avoid wasting work.

So the loop is:

commit or request in -> plan -> execute -> record -> update model -> use that state on the next run

## Checkpoints and Reuse

Verge should support three different ideas, which are not the same:

- caching: reuse a past result when the inputs and environment say it is safe
- checkpointing: save intermediate progress so a process can continue later
- observability: record detailed progress and outcomes, even when nothing is reused

Important rule:

- record data as granularly as possible
- reuse or resume at the coarsest level that stays safe

That means Verge may save fine-grained data for analysis while only checkpointing at safe process or phase boundaries when resuming work.

## Runs, Steps, And Processes

A run is one commit-level, PR-level, or manual evaluation.

A step is a major check inside that run, such as `test`, `build`, or `docs:validate`.

A process is one standalone computation inside a step with a stable identity.

Examples of processes:

- the `api` part of the `test` step
- one smoke-test scenario
- one build target
- one single test case

Runs collect steps. Steps collect processes. Processes are the smallest concrete executions Verge should identify, schedule, retry, and checkpoint.

## Identity Model

Verge should use a general identity model that is not tied to tests.

The core terms should be:

- run: one commit-level, PR-level, or manual evaluation
- step: a major check inside a run
- process: one standalone computation with a stable ID
- process ID: the stable identity of that process
- observation: one recorded result for that process under a particular execution scope

Examples of processes:

- a test case
- a build target
- a smoke-check scenario
- a benchmark case
- a migration validation target
- a release validation scenario
- an agent investigation unit

## Process ID Strategy

Verge should use a hybrid identity model.

Identity should be resolved in this order:

1. explicit stable process ID, if present
2. derived process identity, if no explicit ID exists
3. heuristic continuity matching for history repair, not as the primary identity

This means Verge can work immediately without requiring manual IDs everywhere, while still supporting long-term durable identities where needed.

## Derived Identity

When no explicit process ID exists, Verge should derive one from the structure of the process output.

The derived identity should usually include:

- step kind or framework
- step key or config key
- file or source path, if relevant
- logical path within the process, such as suite path or target path
- process title or logical name
- parameterization key, if relevant

Line numbers should not be part of the primary identity because they are too fragile. They may be stored as extra metadata, but not used as the canonical identifier.

The canonical identity should be stored as:

- a human-readable canonical string
- a deterministic hash of that string for indexing and joins

## Execution Scope

Process identity and execution scope should stay separate.

The process ID answers:

- what logical thing is this?

The execution scope answers:

- under what conditions was it observed?

Execution scope should include things like:

- commit SHA
- platform or runner class
- runtime version
- lockfile or dependency hash
- process config hash

Commit SHA belongs in the execution scope, not in the process identity itself.

## Recording Status

For each process, Verge should save:

- a stable process record
- one or more observations
- append-only lifecycle events

Typical lifecycle events:

- started
- passed
- failed
- skipped
- timed_out
- interrupted

This should support both:

- current state queries
- full historical analysis

## Checkpoint Granularity

Verge should record observations at the finest practical level, often per process.

But resuming should happen at the coarsest safe boundary.

That means:

- save per-process status whenever possible
- allow reuse, skipping, or continuation using those saved results
- avoid pretending that every arbitrary in-process sub-step is safely resumable

For many processes, the right checkpoint boundary will be:

- per process
- per scenario
- per phase

depending on what the process can safely expose.

## Why Not Resume Arbitrary Shell Processes By Magic

Verge should not assume that any random long-running script can be paused and resumed safely.

Instead, processes should cooperate with the system by exposing:

- stable identities
- declared inputs and outputs
- safe checkpoint boundaries
- progress updates
- side-effect rules

This is a durable execution model, not a blind process snapshot system.

## Initial Stack

The initial stack for Verge should be:

- frontend: React + Vite
- backend API: Fastify
- language: TypeScript
- runtime validation and shared schemas: Zod
- database: Postgres
- database access: Kysely plus raw SQL for core scheduling and evidence queries
- artifact and checkpoint storage: S3-compatible object storage
- real-time updates: server-sent events first
- execution layer: Kubernetes Jobs and worker Deployments
- scheduling and coordination: Postgres-first leases and queues
- telemetry: OpenTelemetry
- source control integration: GitHub App, webhooks, and Checks API

This is the first serious version.

Verge should not start with Temporal. If the orchestration model becomes too complex later, a durable workflow system can be introduced then.

## Backend Shape

A production-ready Verge backend should be boring and reliable.

Suggested shape:

- Postgres as the source of truth for runs, steps, process metadata, evidence records, leases, retries, freshness, and health state
- S3-compatible object storage for logs, artifacts, reports, and checkpoint payloads
- a Fastify control-plane API that accepts events, schedules work, serves state, and updates external systems like GitHub Checks
- workers running on Kubernetes that execute processes and continuously report progress
- a React + Vite dashboard that reads the same state and shows repository health, run state, evidence freshness, and current progress

The first orchestration model should stay simple:

- the planner writes work into Postgres
- workers claim work using leases
- workers send heartbeats and progress updates
- evidence and checkpoints are written back into Postgres and object storage
- the API and dashboard read from that shared state

This keeps the first version understandable and fully under our control.

## Main Responsibilities

Verge should do five things well:

1. Model available processes and the areas they observe.
2. Decide what should run next.
3. Execute or trigger that work and monitor it.
4. Save evidence, progress, checkpoints, and outcomes.
5. Expose a queryable picture of repository health to both humans and agents.

## Why This Is More Than Test Optimization

Test optimization is one feature of Verge.

Verge may skip tests, select affected work, or reuse past results. But that is not the whole point.

The bigger idea is:

- repository health is inferred from many partial signals
- coverage is temporal, not binary
- scheduling should optimize for useful signal, not ritual completeness
- agents and normal CI should operate on the same evidence model

## Initial Product Framing

Short version:

> Verge is an evidence-based CI/CD control plane that turns many partial process runs into a live model of repository health.

Longer version:

> Verge decides what repository processes should run, tracks their progress, stores what they observed, and uses that evidence to build a continuously updated picture of what is known, stale, risky, or unknown.

## MVP

A practical first version of Verge should:

- register processes and basic metadata
- ingest commit and pull request events
- run selected processes through Kubernetes-backed workers
- store evidence and health state in Postgres
- store logs and artifacts in object storage
- show live run progress and current repository health
- support reuse of safe cached results
- support process-defined checkpoints for resumable work
- expose a machine-readable API for agents
- use a Postgres-first planner and lease model instead of a heavyweight workflow engine

## Non-Goals For The First Version

- replacing test runners
- replacing compilers
- pausing and resuming arbitrary shell state without cooperation
- solving every CI scheduling problem perfectly
- building a giant generic workflow engine before the evidence model is useful

## Summary

Verge is not just a better test runner and not just another CI dashboard.

It is a control plane for deciding, running, monitoring, and learning from repository processes.

Its purpose is to turn scattered CI activity into a durable, queryable, and increasingly accurate model of repository health.
