---
date: 2026-04-14
title: Commit Health Projection
tags: [verge, commits, health, projection, treemap]
---

# Commit Health Projection

## Purpose

Verge should have two different views of the world:

- `run` is one attempt
- `commit` is the converged health state for one commit across many runs

Those are not the same thing.

A run answers:

- what happened in this specific attempt?

A commit view answers:

- what do we currently know about this commit?
- which processes for this commit are healthy?
- which ones are still failed, missing, queued, or running?

This matches the product goal. Verge should be able to rerun parts of CI and converge toward full health for a commit without pretending every rerun is a brand new independent health state.

## Core Rule

The commit view must not sum all process runs across all attempts.

That would:

- double-count retries
- make a commit look larger every time something is rerun
- confuse cost with health

Instead, Verge should select one current piece of evidence for each process on that commit.

In plain language:

- runs are history
- commit state is the current answer

## Model

The public model stays:

- `run -> step -> process -> observation`

The read model adds:

- `commit`

So the product model becomes:

- `commit` is the converged state
- `run` is one attempt that contributes evidence to that state

## Source Of Truth

The immutable write model stays the same:

- `runs`
- `step_runs`
- `process_runs`
- `observations`
- `run_events`

These records are history and should not be rewritten.

## Projection

Verge should build a derived commit-level projection keyed by process identity.

The key table should be something like:

- `commit_process_state`

Key:

- `repository_id`
- `commit_sha`
- `step_key`
- `process_key`

Stored fields:

- `selected_process_run_id`
- `selected_step_run_id`
- `selected_run_id`
- `status`
- `display_name`
- `kind`
- `file_path`
- `duration_ms`
- `reused`
- `attempt_count`
- `updated_at`

Optional supporting projections:

- `commit_step_state`
- `commit_state`

Those are useful, but `commit_process_state` is the important one.

## Selection Policy

The projection should not be naive latest-row-wins.

It should use explicit precedence rules.

Recommended policy:

1. For each `(repository, commit, step, process)`, look at all candidate process runs.
2. Prefer live active state only for live display:
   - `running`
   - `claimed`
   - `queued`
3. Otherwise prefer the latest terminal evidence:
   - `passed`
   - `reused`
   - `failed`
   - `interrupted`
4. A later `passed` or `reused` should replace an older `failed` for the same process on the same commit.
5. Interrupted or obsolete attempts should not permanently poison the converged commit view if a newer successful result exists.

The important idea is:

- the commit view should represent the best current evidence
- the runs list should preserve the full retry history

## Treemap Semantics

The commit treemap should be separate from the run treemap.

Routes:

- `/repos/:repo/runs/:runId`
- `/repos/:repo/commits/:sha`

The commit treemap should be built from the commit projection, not directly from all raw process runs.

Tree shape:

- root = commit
- children = steps
- optional file nodes
- leaves = processes

Size:

- `valueMs = selected process duration for the current commit state`

Not:

- total duration across all attempts

That keeps the treemap stable and truthful. It shows current health, not accumulated retry cost.

## Cost Versus Health

The commit page should show two different concepts:

1. Converged health

- commit treemap
- current per-process statuses
- current per-step statuses

2. Execution cost

- number of runs for this commit
- total process runs executed
- total execution time spent across all attempts
- number of retries or resumed processes

Health and cost are both useful, but they should not be merged into one visualization.

## Why This Is The Production Shape

This is the most production-ready shape because:

- the write model stays immutable
- the read model is cheap to query
- the commit page does not need to rescan all history every time
- retries and resume flows converge cleanly
- old attempts remain visible without corrupting the current answer

This is also the most scalable approach. As history grows, Verge should read the projection for commit health and only read raw run history when the user is explicitly looking at attempts.

## UI Implications

The UI should show:

- run page: one attempt
- commit page: converged state for one commit

The commit page should include:

- commit health summary
- commit treemap
- step health summary
- process table
- attempt history for that commit

The run page should keep:

- exact events from that attempt
- exact artifacts from that attempt
- exact step/process timing from that attempt

## Recommended Next Implementation

1. Add `commit_process_state` as a projection table.
2. Update projection logic whenever process runs reach terminal state.
3. Add `GET /repositories/:repo/commits/:sha`.
4. Add `GET /repositories/:repo/commits/:sha/treemap`.
5. Build a commit page that reads the projection.
6. Keep run pages unchanged as attempt history views.
