---
date: 2026-04-12
title: Verge Basic Objects
tags: [verge, ci-cd, data-model, objects]
---

# Verge Basic Objects

This document describes the smallest object model that makes Verge understandable.

It is intentionally simpler than a full database schema. The goal is to explain the main objects in plain language and show how they fit together.

This is the core runtime shape:

process spec -> run -> process -> observation

Everything else should support that shape, not hide it.

## The Main Objects

### Repository

A repository is the codebase Verge is managing.

Plainly:

- this is the repo Verge is watching
- it is the top-level container for everything else

Example:

- the Verge repo itself

### Process Spec

A process spec is the reusable recipe for a kind of work.

Plainly:

- this says how a family of processes should be produced
- it is the definition, not one specific computation

Examples:

- `test`
- `build`
- `lint`
- `docs:validate`

A process spec should answer:

- what command or runner is used
- how concrete processes are produced
- what repo areas it observes
- whether it supports reuse
- whether it supports checkpoints

### Run Request

A run request is a reason to do work.

Plainly:

- something happened and Verge now needs to evaluate the repo
- this is the trigger, not the work itself

Examples:

- a push to a branch
- a pull request event
- a manual request from the UI or API

A run request should answer:

- what triggered this
- which repo and commit it refers to
- what changed

### Run

A run is one evaluation of one process spec for one run request.

Plainly:

- this is the container for all concrete processes produced from one spec for one request

Examples:

- the `test` run for commit `abc123`
- the `build` run for pull request `#14`

A run should answer:

- which process spec this is
- which request it belongs to
- what status it has
- whether it ran fresh or reused prior work

### Process

A process is one standalone computation with a stable ID.

Plainly:

- this is one concrete piece of work Verge can identify and run
- if you think of a single test, build target, or smoke scenario, that is a process

Examples:

- `api` tests
- `web` tests
- one build target
- one smoke-test scenario
- one single test case

A process should answer:

- what exact computation this is
- what stable key identifies it
- which process spec produced it

### Observation

An observation is what a run learned about a process.

Plainly:

- this is the useful output from doing the work
- it is more important than a simple green or red status

Examples:

- the build target passed
- `api` tests failed
- docs validation observed the `docs` area successfully
- a benchmark result changed

An observation should answer:

- what was observed
- what the result was
- when it was observed
- under what execution conditions it was observed

### Repo Area

A repo area is a part of the repository that Verge cares about.

Plainly:

- this is a named surface of the repo
- process specs and processes observe areas, and health is rolled up by area

Examples:

- `api`
- `web`
- `worker`
- `docs`
- `packages`

### Repo Area State

Repo area state is the current rolled-up status of one repo area.

Plainly:

- this is Verge's current view of how well a part of the repo is covered
- it is derived from observations over time

Examples:

- `api` is fresh and healthy
- `docs` is stale
- `worker` is unknown

This is what the dashboard and health queries should show most often.

## Supporting Objects

These objects matter, but they should support the main model instead of competing with it.

### Run Event

A run event is a timeline entry.

Plainly:

- this records things that happened while a run was in progress

Examples:

- started
- claimed by worker
- passed
- failed
- interrupted

### Artifact

An artifact is a saved output file or blob.

Plainly:

- this is something produced by a run that Verge wants to keep

Examples:

- logs
- test reports
- coverage reports
- screenshots

### Checkpoint

A checkpoint is saved progress for a run.

Plainly:

- this says which processes in the run are already done and which are still left
- it is not a memory dump or a paused shell session

Examples:

- `api` and `web` processes are done, `worker` is still pending
- smoke-test scenarios A and B are done, C is left

## How The Objects Interact

The normal flow should look like this:

1. A `Repository` receives a change or request.
2. Verge creates a `RunRequest`.
3. Verge selects one or more `ProcessSpec` records that matter for that request.
4. Verge creates a `Run` for each selected process spec.
5. Each `Run` materializes one or more `Process` records with stable keys.
6. Workers execute those processes for the run.
7. While work is in progress, Verge records `RunEvent` entries and saves any `Artifact` records.
8. The run produces `Observation` records for the processes that ran.
9. Those observations update `RepoAreaState` for the affected `RepoArea` records.
10. The UI and API show current runs, process progress, and repository health.

## Relationship Summary

The model should read like this:

- one `Repository` has many `ProcessSpec` records
- one `RunRequest` belongs to one `Repository`
- one `RunRequest` creates many `Run` records
- one `Run` belongs to one `ProcessSpec`
- one `Run` contains one or more `Process` records
- one `Run` can produce many `Observation` records
- many `Observation` records update one `RepoAreaState`
- one `Run` can have many `RunEvent`, `Artifact`, and `Checkpoint` records

## Simple Example

Suppose a pull request changes files in `apps/api` and `docs`.

Verge would do something like this:

1. Create one `RunRequest` for the pull request.
2. Select the `lint`, `test`, `build`, and `docs:validate` process specs.
3. Create four `Run` records, one for each process spec.
4. Materialize concrete processes for each run.
5. For the `test` run, materialize processes such as `api` and `packages` because those are the relevant stable computations for that repo.
6. Execute those processes.
7. Save events, logs, and reports while they run.
8. Record observations such as:
   - `lint` passed
   - `api` tests failed
   - `docs:validate` passed
9. Update area state so `docs` is fresh, `api` is fresh but failed, and unrelated areas may remain stale or unknown.

## What Should Stay Secondary

The model gets harder to understand when too many internal objects become first-class.

For the first version, these should stay secondary:

- lease details
- heartbeat details
- detailed planning internals
- low-level checkpoint payload structure
- deep identity-repair logic

They still matter, but they are support machinery, not the main product story.

## Summary

If the model feels confusing, come back to this:

- a process spec is the recipe
- a run is one evaluation of that recipe for one request
- a process is one standalone computation inside that run
- an observation is what the work learned

Repository health is then just the rolled-up result of many observations over time.
