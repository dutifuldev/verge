---
date: 2026-04-12
title: Verge Basic Objects
tags: [verge, ci-cd, data-model, objects]
---

# Verge Basic Objects

This document describes the smallest object model that makes Verge understandable.

It is intentionally simpler than a full database schema. The goal is to explain the main objects in plain language and show how they fit together.

This is the core runtime shape:

process -> run -> task -> observation

Everything else should support that shape, not hide it.

## The Main Objects

### Repository

A repository is the codebase Verge is managing.

Plainly:

- this is the repo Verge is watching
- it is the top-level container for everything else

Example:

- the Verge repo itself

### Process Definition

A process definition describes a kind of work Verge knows how to run.

Plainly:

- this says what kind of check or job exists
- it is a reusable definition, not one specific execution

Examples:

- `lint`
- `test`
- `build`
- `docs:validate`

A process definition should answer:

- what command or runner is used
- what repo areas it observes
- whether it can split into tasks
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

A run is one process being evaluated for one run request.

Plainly:

- this is one actual attempt to run or reuse a process for a specific commit or request

Examples:

- the `test` run for commit `abc123`
- the `build` run for pull request `#14`

A run should answer:

- which process this is
- which request it belongs to
- what status it has
- whether it ran fresh or reused a prior result

### Run Task

A run task is one runnable piece of a run.

Plainly:

- if a run is too large or naturally breaks into parts, Verge runs those parts as tasks
- a task is the smallest chunk Verge schedules, retries, and checkpoints

Examples:

- `api` tests
- `web` tests
- one smoke-test scenario
- the whole build, if build is not split

A run may have:

- one task, if it is not split
- many tasks, if it is split

### Observation

An observation is what a run or task learned.

Plainly:

- this is the useful output from doing the work
- it is more important than a simple green or red status

Examples:

- the build passed
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
- processes observe areas, and health is rolled up by area

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

- this records things that happened while a run or task was in progress

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

- this says which tasks are already done and which are still left
- it is not a memory dump or a paused shell session

Examples:

- `api` and `web` test tasks are done, `worker` is still pending
- smoke-test scenarios A and B are done, C is left

### Subject

A subject is one specific thing observed inside a process.

Plainly:

- this is finer-grained than a task
- you only need this when you care about stable identity below the task level

Examples:

- one test case
- one build target
- one smoke scenario

Subjects are useful, but they are not the first thing a user needs to understand Verge.

## How The Objects Interact

The normal flow should look like this:

1. A `Repository` receives a change or request.
2. Verge creates a `RunRequest`.
3. Verge selects one or more `ProcessDefinition` records that matter for that request.
4. Verge creates a `Run` for each selected process.
5. Each `Run` either stays whole or expands into one or more `RunTask` records.
6. Workers execute the `RunTask` records.
7. While tasks run, Verge records `RunEvent` entries and saves any `Artifact` records.
8. The run and its tasks produce `Observation` records.
9. Those observations update `RepoAreaState` for the affected `RepoArea` records.
10. The UI and API show current runs, task progress, and repository health.

## Relationship Summary

The model should read like this:

- one `Repository` has many `ProcessDefinition` records
- one `RunRequest` belongs to one `Repository`
- one `RunRequest` creates many `Run` records
- one `Run` belongs to one `ProcessDefinition`
- one `Run` has one or more `RunTask` records
- one `Run` or `RunTask` can produce many `Observation` records
- many `Observation` records update one `RepoAreaState`
- one `Run` or `RunTask` can have many `RunEvent`, `Artifact`, and `Checkpoint` records

## Simple Example

Suppose a pull request changes files in `apps/api` and `docs`.

Verge would do something like this:

1. Create one `RunRequest` for the pull request.
2. Select the `lint`, `test`, `build`, and `docs:validate` process definitions.
3. Create four `Run` records, one for each process.
4. Split the `test` run into `api` and `packages` tasks because those are the relevant named tasks for that repo.
5. Run `lint`, `build`, and `docs:validate`, along with the `api` and `packages` test tasks.
6. Save events, logs, and reports while those tasks run.
7. Record observations such as:
   - `lint` passed
   - `api` tests failed
   - `docs:validate` passed
8. Update area state so `docs` is fresh, `api` is fresh but failed, and unrelated areas may remain stale or unknown.

## What Should Stay Secondary

The model gets harder to understand when too many internal objects become first-class.

For the first version, these should stay secondary:

- lease details
- heartbeat details
- detailed planning internals
- low-level checkpoint payload structure
- subject history repair logic

They still matter, but they are support machinery, not the main product story.

## Summary

If the model feels confusing, come back to this:

- a process is a kind of work
- a run is one execution of that work for one request
- a task is one piece of that run
- an observation is what the work learned

Repository health is then just the rolled-up result of many observations over time.
