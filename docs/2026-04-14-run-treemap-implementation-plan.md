---
date: 2026-04-14
title: Run Treemap Implementation Plan
tags: [verge, ui, treemap, runs, visualization]
---

# Run Treemap Implementation Plan

## Purpose

Verge needs one strong overview visualization for a run that answers a simple question:

- where did the time go in this run?

The right primary visualization for that question is a treemap.

The treemap should not replace the run table, step detail page, or process list. It should be the high-level spatial summary for one run.

## Core Rule

The treemap should use Verge's existing public model directly:

- `run`
- `step`
- `process`

It should not introduce a new product object just for visualization.

If grouping helps readability, the treemap may add a virtual file node for file-based processes, but only as a derived display layer. That file node is not a new core object in the Verge model.

## What The Treemap Should Show

The treemap should visualize the full run as a hierarchy:

- root: one `run`
- second level: `step`
- optional third level: `file path`, when many processes belong to the same file
- leaves: individual `process` records

The main encoding should be:

- area = duration for this specific run
- color = status

That means the treemap is a run-specific read model, not a historical aggregate.

## Why A Treemap

A treemap is the right fit for the main question because it:

- uses space efficiently
- makes large expensive areas obvious immediately
- works well when there are many processes
- feels familiar to anyone who has used package size treemaps

It is especially useful for:

- test-heavy steps with many individual processes
- understanding whether one step dominates the run
- spotting unusually expensive files or processes

## What A Treemap Does Not Solve

A treemap is not enough on its own.

It is weak at:

- showing exact ordering
- showing concurrency
- showing fine-grained timing comparisons

So the production-ready visualization model should be:

- treemap for proportional time distribution
- process table for exact values
- timeline view later for ordering and parallelism

The treemap is the primary spatial overview, not the only run visualization.

## Data Model Requirements

The treemap should be powered by existing immutable run data.

The important records are:

- `runs`
- `step_runs`
- `process_runs`

The required fields are:

### On `process_runs`

- `id`
- `step_run_id`
- `process_key`
- `display_name`
- `kind`
- `file_path`
- `status`
- `attempt_count`
- `started_at`
- `finished_at`
- `duration_ms`

### On `step_runs`

- `id`
- `run_id`
- `step_key`
- `display_name`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`

### On `runs`

- `id`
- `repository_id`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`

If `duration_ms` is not stored explicitly yet, it should be added. It should be written as part of the normal status refresh path instead of recomputed ad hoc in every read query.

## Duration Semantics

The treemap should size nodes by summed process duration, not by wall clock duration.

This is important.

Treemap values must add up cleanly. Process durations can be summed. Wall time cannot be summed safely when work happens in parallel.

So the rule should be:

- treemap size uses `process_runs.duration_ms`
- step and run treemap node values are sums of child process durations

At the same time, Verge should still keep wall duration available for detail views and tooltips.

So the UI should distinguish:

- `process duration`
- `step wall time`
- `run wall time`

The treemap is about accumulated work, not elapsed wall-clock critical path.

## Reused Processes

Reused processes should still appear in the treemap.

They matter because they are part of the run result and they show where work would have been spent.

The clean rule is:

- `reused` processes appear as leaves
- their area uses the original process duration snapshot
- their color indicates `reused`

This gives the user a useful answer:

- what took time in the underlying work
- what was freshly executed
- what was reused

## Failed Processes

Failed processes should appear like any other process.

They should:

- keep their observed duration
- use failure color
- stay clickable

This is important because expensive failures are often the first thing a user wants to spot.

## File Grouping

File grouping should be optional and derived.

Recommended rule:

- if many processes in a step share a `file_path`, group them under a file node
- if a step has only a few processes or no meaningful file path, show processes directly under the step

This keeps the tree readable for tests and lint-like steps without forcing file grouping onto every step type.

Examples:

- `test`
  - `apps/api/src/index.test.ts`
  - individual test processes

- `lint`
  - file node may be unnecessary if the process is already one file

- `build`
  - probably no file node
  - process leaves directly under the step

## API Design

The treemap should be exposed through a dedicated read endpoint.

Recommended endpoint:

- `GET /runs/:id/treemap`

This endpoint should return a fully prepared tree for the UI.

That is cleaner than making the frontend reconstruct the hierarchy from several other endpoints.

### Recommended Response Shape

```ts
type TreemapNode = {
  id: string;
  kind: "run" | "step" | "file" | "process";
  label: string;
  valueMs: number;
  status: "planned" | "queued" | "running" | "passed" | "failed" | "reused" | "interrupted" | "skipped";
  filePath?: string | null;
  stepKey?: string;
  processKey?: string;
  reused?: boolean;
  attemptCount?: number;
  children?: TreemapNode[];
};
```

The backend should compute:

- hierarchy
- summed values
- status for each display node

This keeps the frontend simpler and makes the output stable across clients.

## Backend Implementation

### Phase 1: Duration Persistence

Add explicit `duration_ms` fields to:

- `runs`
- `step_runs`
- `process_runs`

Populate them from:

- `finished_at - started_at`

Store `null` while work is unfinished.

### Phase 2: Treemap Read Model

Add one read function in the DB layer:

- `getRunTreemap(runId)`

It should:

- fetch the run
- fetch its step runs
- fetch all process runs for those steps
- build the derived tree
- sum child duration values upward

### Phase 3: API Route

Add:

- `GET /runs/:id/treemap`

Return:

- `404` if the run does not exist
- the full treemap payload otherwise

### Phase 4: UI Integration

Add the treemap to the run detail page.

The treemap should sit near the top of the run page, below the run summary and above the step list.

### Phase 5: Interaction

The treemap should support:

- hover tooltip
- click step -> navigate or filter to step
- click process -> navigate or highlight in step detail

## Frontend Implementation

The UI should use:

- `d3-hierarchy` for treemap layout
- SVG for the initial implementation

SVG is the right first choice because:

- the node counts are manageable
- the implementation is easier to debug
- accessibility and interaction are simpler

The styling should stay aligned with the current GitHub-dark direction.

### Node Treatment

- step nodes should have visible labels
- process labels should appear when the rectangle is large enough
- tiny leaves should remain visible as colored blocks without forced text overlap

### Tooltip Content

Tooltips should show:

- label
- status
- process duration
- wall duration, when relevant
- file path, when present
- attempt count

### Colors

Use status colors consistently:

- passed
- failed
- reused
- running
- queued
- interrupted

Do not introduce decorative categorical colors. Status is the meaningful encoding.

## Placement In The Product

The treemap belongs on the run detail page.

That page should then answer three different questions:

- summary cards: what happened overall?
- treemap: where did the time go?
- step list: what ran, exactly?

The step detail page remains the place for the full process list, exact statuses, logs, checkpoints, and artifacts.

## Relationship To Future Timeline View

The treemap should not try to explain concurrency.

If Verge later adds a timeline view, the split should be:

- treemap = distribution
- timeline = ordering and overlap
- table = exact details

That is the clean long-term visualization stack.

## Acceptance Criteria

The first production-ready version is done when:

1. every completed process run has a usable duration value
2. the API can return a run treemap tree
3. the run page renders the treemap
4. the treemap shows individual process leaves
5. the treemap makes reused processes visibly distinct
6. the user can click from the treemap into relevant step or process detail
7. the treemap stays readable for large test-heavy runs

## Non-Goals For The First Version

Do not do these in the first pass:

- heatmap animation
- critical path analysis
- flamegraph replacement
- arbitrary user-defined grouping
- cross-run aggregate treemaps
- full timeline/concurrency visualization

The first version should be a clear, reliable run-level size view, not an observability platform all at once.
