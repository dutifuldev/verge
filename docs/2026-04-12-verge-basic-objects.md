---
date: 2026-04-12
title: Verge Basic Objects
tags: [verge, ci-cd, data-model, objects]
---

# Verge Basic Objects

This document describes the smallest object model that makes Verge understandable.

The goal is to explain the main objects in plain language and show how they fit together.

The public runtime shape should be:

```text
run -> step -> process -> observation
```

This is deliberately analogous to CI systems people already know:

- a `run` is the whole evaluation for one commit, pull request event, or manual trigger
- a `step` is a major check inside that run, like `build`, `test`, or `lint`
- a `process` is the smallest meaningful thing Verge tracks inside a step
- an `observation` is the result recorded from the work

## Naming Note

Some current implementation records still use older internal names such as `run_request`, `run`, and `process_spec`.

For product and concept docs, the intended model should be:

- `run` = the commit-level evaluation
- `step` = a major check inside that run
- `process` = the smallest tracked unit inside a step

## The Main Objects

### Repository

A repository is the codebase Verge is managing.

Plainly:

- this is the repo Verge is watching
- it is the top-level container for everything else

Example:

- the Verge repo itself

### Run

A run is the whole evaluation Verge performs for one trigger.

Plainly:

- this is the thing created for a commit, pull request event, or manual trigger
- it is the top-level execution record users should think about

Examples:

- the run for commit `abc123`
- the run created by pull request `#14`
- a manually triggered run from the UI

A run should answer:

- what triggered it
- which repo and commit it belongs to
- which steps it contains
- whether the overall evaluation passed, failed, or is still running

### Step

A step is one major check inside a run.

Plainly:

- this is a category of evaluation inside the run
- it is the level that maps most closely to things like `build`, `test`, `lint`, or `typecheck`

Examples:

- `build`
- `test`
- `lint`
- `docs:validate`

A step should answer:

- what kind of check this is
- why it was included in the run
- whether it ran fresh, reused prior work, or resumed from a checkpoint
- what processes it contains

### Process

A process is one concrete unit of work inside a step.

Plainly:

- this is the smallest meaningful thing Verge wants to track as its own result
- this is the unit Verge can schedule, retry, checkpoint, and observe directly
- it should not be an execution chunk, shard, or convenience grouping

Examples:

- one individual test
- one lint target
- one build target
- one smoke-test scenario
- one document check

A process should answer:

- what exact computation this is
- what stable key identifies it across runs
- what per-run process id identifies this specific record
- what file path is associated with it, if a file path exists
- which step it belongs to

### Observation

An observation is what Verge learned from a process or step.

Plainly:

- this is the useful result, not just the fact that something ran
- it is the evidence Verge accumulates over time

Examples:

- one test passed
- the `docs` area was observed successfully
- a build target failed
- a benchmark changed

An observation should answer:

- what was observed
- what the result was
- when it was observed
- under what execution conditions it was observed

### Repo Area

A repo area is a named surface of the repository that Verge cares about.

Examples:

- `api`
- `web`
- `worker`
- `docs`
- `packages`

Processes observe repo areas, and health is rolled up by area.

### Repo Area State

Repo area state is Verge's current rolled-up view of one area.

Plainly:

- this is what the dashboard should show most often
- it summarizes whether an area is fresh, stale, healthy, failed, or unknown

Examples:

- `api` is fresh and healthy
- `docs` is stale
- `worker` is unknown

## Supporting Objects

These objects matter, but they support the main model instead of replacing it.

### Trigger

A trigger is the thing that caused a run to exist.

Examples:

- a push
- a pull request event
- a manual action in the UI

### Run Event

A run event is a timeline entry.

Examples:

- started
- claimed by worker
- passed
- failed
- interrupted

### Artifact

An artifact is a saved output file or blob.

Examples:

- logs
- test reports
- coverage reports
- screenshots

### Checkpoint

A checkpoint is saved progress for a step.

Plainly:

- this says which processes in the step are already done and which are still left
- it is not a paused shell session or a memory snapshot

Examples:

- three document checks are done and one is still pending
- smoke scenarios A and B are done, C is left

## How The Objects Interact

The normal flow should look like this:

1. A `Repository` receives a trigger.
2. Verge creates a `Run`.
3. Verge decides which `Step` records belong in that run.
4. Each step materializes one or more `Process` records.
5. Workers execute those processes.
6. While work is in progress, Verge records `RunEvent` entries and saves any `Artifact` records.
7. The work produces `Observation` records.
8. Those observations update `RepoAreaState` for affected `RepoArea` records.
9. The UI and API show current runs, step progress, process progress, and repository health.

## Relationship Summary

The model should read like this:

- one `Repository` has many `Run` records over time
- one `Run` belongs to one `Repository`
- one `Run` contains many `Step` records
- one `Step` contains one or more `Process` records
- one `Run` and its steps can produce many `Observation` records
- many `Observation` records update one `RepoAreaState`
- one `Run` can have many `RunEvent`, `Artifact`, and `Checkpoint` records

## Simple Example

Suppose a pull request changes files in `apps/api` and `docs`.

Verge would do something like this:

1. Create one `Run` for the pull request.
2. Select the `lint`, `test`, `build`, and `docs:validate` steps for that run.
3. Materialize concrete processes for each step.
4. For the `test` step, materialize one process per real test Verge wants to track.
5. Run those processes and record one observation per process result.
6. If a step supports resume, record which processes finished and which remain pending in a checkpoint.
7. Save events, logs, and reports while they run.
8. Record observations such as:
   - `lint` passed
   - one test failed
   - `docs:validate` passed
9. Update area state so `docs` is fresh, `api` is fresh but failed, and unrelated areas may remain stale or unknown.

## Summary

If the model feels confusing, come back to this:

- a `run` is the whole evaluation for one commit or trigger
- a `step` is a major check inside that run
- a `process` is the smallest tracked unit inside a step
- an `observation` is what the work learned

Repository health is then the rolled-up result of many observations over time.
