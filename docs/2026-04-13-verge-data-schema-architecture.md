---
date: 2026-04-13
title: Verge Data Schema Architecture
tags: [verge, data-model, schema, database, architecture]
---

# Verge Data Schema Architecture

This document describes the clean long-term data model Verge should use.

The goal is not to mirror the current table names exactly. The goal is to describe the best durable model for Verge as a product.

The public runtime shape should stay:

```text
run -> step -> process -> observation
```

The storage model should reflect that shape directly.

## Design Rules

The data model should follow these rules:

- a `run` is the whole evaluation for one commit, pull request event, or manual trigger
- a `step` is a major check inside a run, such as `test`, `build`, or `lint`
- a `process` is the smallest meaningful thing Verge tracks as its own result
- a `process run` is one execution of one process in one step run
- process identity should be stable across runs
- execution history should be self-contained on execution rows
- current config should be separate from historical evidence
- execution convenience should not become a first-class product object
- `repo_area_state` should be a derived read model, not the source of truth

That means Verge should not expose product concepts like chunk, batch, or shard as top-level objects. If execution gets optimized internally, that should stay an implementation detail.

## The Main Objects

The clean product model should be:

- `Repository`
- `RepoArea`
- `StepSpec`
- `Process`
- `Run`
- `StepRun`
- `ProcessRun`
- `Observation`
- `RunEvent`
- `Artifact`
- `Checkpoint`
- `RepoAreaState`

## Identity Rules

The important identity rules are:

- `Repository` is keyed by `slug`
- `StepSpec` is keyed by `(repository_id, key)`
- `Process` is keyed by `(step_spec_id, key)`
- `Run` has its own UUID and is not keyed only by commit SHA
- `StepRun` is keyed by its own UUID, and usually unique on `(run_id, step_key)`
- `ProcessRun` is keyed by its own UUID, and usually unique on `(step_run_id, process_key)`

This means:

- a process has one stable identity across runs
- each time it runs, it gets a new `process_run.id`
- the execution rows still make sense even if current step config changes later

## Type-Level Schemas

These are the TypeScript-level shapes the system should aim for.

```ts
type Repository = {
  id: string;
  slug: string;
  displayName: string;
  rootPath: string;
  defaultBranch: string;
  createdAt: string;
};

type RepoArea = {
  id: string;
  repositoryId: string;
  key: string;
  displayName: string;
  pathPrefixes: string[];
  createdAt: string;
};

type StepSpec = {
  id: string;
  repositoryId: string;
  key: string;
  displayName: string;
  description: string;
  kind: string;
  baseCommand: string[];
  cwd: string;
  observedAreaKeys: string[];
  materialization: unknown;
  reuseEnabled: boolean;
  checkpointEnabled: boolean;
  alwaysRun: boolean;
  createdAt: string;
  updatedAt: string;
};

type Process = {
  id: string;
  stepSpecId: string;
  key: string;
  displayName: string;
  kind: string;
  filePath: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Run = {
  id: string;
  repositoryId: string;
  trigger: "manual" | "push" | "pull_request";
  commitSha: string;
  branch: string | null;
  pullRequestNumber: number | null;
  changedFiles: string[];
  status: "queued" | "running" | "passed" | "failed" | "reused" | "interrupted";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type StepRun = {
  id: string;
  runId: string;
  stepSpecId: string | null;
  stepKey: string;
  displayName: string;
  kind: string;
  baseCommand: string[];
  cwd: string;
  observedAreaKeys: string[];
  materialization: unknown;
  configFingerprint: string;
  fingerprint: string;
  status: "queued" | "running" | "passed" | "failed" | "reused" | "interrupted";
  planReason: string;
  reusedFromStepRunId: string | null;
  checkpointSourceStepRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type ProcessRun = {
  id: string;
  stepRunId: string;
  processId: string | null;
  processKey: string;
  displayName: string;
  kind: string;
  filePath: string | null;
  metadata: Record<string, unknown>;
  status: "queued" | "claimed" | "running" | "passed" | "failed" | "reused" | "skipped" | "interrupted";
  selectionPayload: Record<string, unknown>;
  attemptCount: number;
  claimedBy: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

type Observation = {
  id: string;
  stepRunId: string;
  processRunId: string | null;
  processId: string | null;
  areaKey: string | null;
  status: "passed" | "failed" | "unknown" | "reused";
  summary: Record<string, unknown>;
  executionScope: Record<string, unknown>;
  observedAt: string;
};

type RunEvent = {
  id: string;
  stepRunId: string;
  processRunId: string | null;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type Artifact = {
  id: string;
  stepRunId: string;
  processRunId: string | null;
  artifactKey: string;
  storagePath: string;
  mediaType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type Checkpoint = {
  id: string;
  stepRunId: string;
  stepSpecId: string;
  fingerprint: string;
  completedProcessKeys: string[];
  pendingProcessKeys: string[];
  storagePath: string | null;
  createdAt: string;
  resumableUntil: string;
};

type RepoAreaState = {
  repoAreaId: string;
  latestStatus: "passed" | "failed" | "unknown" | "reused";
  freshnessBucket: "fresh" | "stale" | "unknown";
  lastObservedAt: string | null;
  lastSuccessfulObservedAt: string | null;
  updatedAt: string;
};
```

## Recommended Postgres Tables

The clean table layout should be:

- `repositories`
- `repo_areas`
- `step_specs`
- `processes`
- `runs`
- `step_runs`
- `process_runs`
- `run_events`
- `observations`
- `artifacts`
- `checkpoints`
- `repo_area_state`

### `repositories`

One row per managed repository.

Columns:

- `id uuid primary key`
- `slug text not null unique`
- `display_name text not null`
- `root_path text not null`
- `default_branch text not null`
- `created_at timestamptz not null default now()`

### `repo_areas`

One row per named repository surface.

Columns:

- `id uuid primary key`
- `repository_id uuid not null references repositories(id)`
- `key text not null`
- `display_name text not null`
- `path_prefixes jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default now()`

Constraints:

- `unique(repository_id, key)`

### `step_specs`

One current step definition inside one repository.

This is config state, not the historical source of truth.

Columns:

- `id uuid primary key`
- `repository_id uuid not null references repositories(id)`
- `key text not null`
- `display_name text not null`
- `description text not null`
- `kind text not null`
- `base_command jsonb not null`
- `cwd text not null`
- `observed_area_keys jsonb not null`
- `materialization jsonb not null`
- `reuse_enabled boolean not null`
- `checkpoint_enabled boolean not null`
- `always_run boolean not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- `unique(repository_id, key)`

### `processes`

One stable process identity inside one step spec.

This is not one execution. This is the current process catalog.

This table is optional in spirit. It is useful for the latest known process set, but old runs should not depend on it staying unchanged forever.

Columns:

- `id uuid primary key`
- `step_spec_id uuid not null references step_specs(id)`
- `key text not null`
- `display_name text not null`
- `kind text not null`
- `file_path text null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:

- `unique(step_spec_id, key)`

### `runs`

One top-level evaluation.

Columns:

- `id uuid primary key`
- `repository_id uuid not null references repositories(id)`
- `trigger text not null`
- `commit_sha text not null`
- `branch text null`
- `pull_request_number integer null`
- `changed_files jsonb not null`
- `status text not null`
- `created_at timestamptz not null default now()`
- `started_at timestamptz null`
- `finished_at timestamptz null`

Indexes:

- `(repository_id, created_at desc)`
- `(repository_id, commit_sha)`
- `(repository_id, pull_request_number)`

### `step_runs`

One execution of one step spec inside one run.

Columns:

- `id uuid primary key`
- `run_id uuid not null references runs(id)`
- `step_spec_id uuid null references step_specs(id)`
- `step_key text not null`
- `display_name text not null`
- `kind text not null`
- `base_command jsonb not null`
- `cwd text not null`
- `observed_area_keys jsonb not null`
- `materialization jsonb not null`
- `config_fingerprint text not null`
- `fingerprint text not null`
- `status text not null`
- `plan_reason text not null`
- `reused_from_step_run_id uuid null references step_runs(id)`
- `checkpoint_source_step_run_id uuid null references step_runs(id)`
- `created_at timestamptz not null default now()`
- `started_at timestamptz null`
- `finished_at timestamptz null`

Constraints:

- `unique(run_id, step_key)`

Indexes:

- `(step_spec_id, fingerprint)`
- `(run_id, step_key)`
- `(status, created_at desc)`

### `process_runs`

One execution of one process inside one step run.

Columns:

- `id uuid primary key`
- `step_run_id uuid not null references step_runs(id)`
- `process_id uuid null references processes(id)`
- `process_key text not null`
- `display_name text not null`
- `kind text not null`
- `file_path text null`
- `metadata jsonb not null default '{}'::jsonb`
- `status text not null`
- `selection_payload jsonb not null`
- `attempt_count integer not null default 0`
- `claimed_by text null`
- `lease_expires_at timestamptz null`
- `last_heartbeat_at timestamptz null`
- `created_at timestamptz not null default now()`
- `started_at timestamptz null`
- `finished_at timestamptz null`

Constraints:

- `unique(step_run_id, process_key)`

Indexes:

- `(step_run_id, status)`
- `(process_key, created_at desc)`
- `(claimed_by, lease_expires_at)`

### `run_events`

Append-only timeline events.

Columns:

- `id uuid primary key`
- `step_run_id uuid not null references step_runs(id)`
- `process_run_id uuid null references process_runs(id)`
- `kind text not null`
- `message text not null`
- `payload jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Indexes:

- `(step_run_id, created_at asc)`
- `(process_run_id, created_at asc)`

### `observations`

Evidence recorded from a step run or process run.

Columns:

- `id uuid primary key`
- `step_run_id uuid not null references step_runs(id)`
- `process_run_id uuid null references process_runs(id)`
- `process_id uuid null references processes(id)`
- `area_key text null`
- `status text not null`
- `summary jsonb not null default '{}'::jsonb`
- `execution_scope jsonb not null default '{}'::jsonb`
- `observed_at timestamptz not null default now()`

Indexes:

- `(step_run_id, observed_at asc)`
- `(process_run_id, observed_at asc)`
- `(process_id, observed_at desc)`

### `artifacts`

References to saved files or blobs.

Columns:

- `id uuid primary key`
- `step_run_id uuid not null references step_runs(id)`
- `process_run_id uuid null references process_runs(id)`
- `artifact_key text not null`
- `storage_path text not null`
- `media_type text not null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Indexes:

- `(step_run_id, created_at asc)`
- `(process_run_id, created_at asc)`

### `checkpoints`

Saved resumable progress for one step run.

Columns:

- `id uuid primary key`
- `step_run_id uuid not null references step_runs(id)`
- `step_spec_id uuid not null references step_specs(id)`
- `fingerprint text not null`
- `completed_process_keys jsonb not null`
- `pending_process_keys jsonb not null`
- `storage_path text null`
- `created_at timestamptz not null default now()`
- `resumable_until timestamptz not null`

Indexes:

- `(step_spec_id, fingerprint, created_at desc)`
- `(resumable_until)`

### `repo_area_state`

Current rolled-up health for one repo area.

This is a projection for fast reads. It should be recomputable from runs, process runs, and observations.

Columns:

- `repo_area_id uuid primary key references repo_areas(id)`
- `latest_status text not null`
- `freshness_bucket text not null`
- `last_observed_at timestamptz null`
- `last_successful_observed_at timestamptz null`
- `updated_at timestamptz not null default now()`

## Relationship Summary

The core relationships should be:

- one `Repository` has many `RepoArea`
- one `Repository` has many `StepSpec`
- one `StepSpec` has many stable `Process`
- one `Repository` has many `Run`
- one `Run` has many `StepRun`
- one `StepRun` may point to one current `StepSpec`, but it keeps its own step snapshot
- one `StepRun` has many `ProcessRun`
- one `ProcessRun` may point to one current `Process`, but it keeps its own process snapshot
- one `StepRun` can have many `RunEvent`
- one `StepRun` can have many `Observation`
- one `StepRun` can have many `Artifact`
- one `StepRun` can have many `Checkpoint`
- many observations update one `RepoAreaState`

## What Stores Success Or Failure

The main success field should be:

- `process_runs.status`

That is the primary answer to:

- did this process succeed in this execution?

The same outcome can also appear in:

- `run_events`
- `observations`

But those are supporting records. The main execution status belongs on `process_runs`.

## What A Process Run Result Should Contain

The result of a process run should not just be one Boolean. The durable result should be a small set of linked records:

- `process_runs.status`
- `run_events`
- `observations`
- `artifacts`
- `checkpoints`, when checkpointing is enabled

That lets Verge keep:

- simple pass or fail state
- timing
- logs
- structured evidence
- resumable progress

The important point is that `process_runs` should already contain the fields needed to understand what ran. Old history should not depend on a mutable catalog row still looking the same later.

## How Processes Get Created

Current process catalog rows should be created from step materialization and discovery.

The flow should be:

1. Verge loads a `StepSpec`.
2. Verge materializes the real processes for that step.
3. Verge upserts them into `processes` using `(step_spec_id, key)`.
4. When a run happens, Verge creates `step_runs` with a step snapshot.
5. Verge creates `process_runs` with process snapshots for the chosen `StepRun`.

So the process key should not be globally unique by itself. It should be scoped under the step spec.

That means the real stable identity is:

- `step_spec_id + process.key`

But the durable historical record lives on `process_runs`, not on endlessly versioned process definitions.

## Why This Model Is Better Than The Current One

The current implementation works, but some names still leak earlier modeling:

- `run_requests` is really the top-level `runs` table
- current `runs` are really `step_runs`
- current `run_processes` are really `process_runs`
- current `process_specs` are really `step_specs`

The model in this document is cleaner because it separates:

- stable identity from execution
- product concepts from implementation details
- run-level, step-level, and process-level records
- current config from immutable execution history

It also avoids a storage-heavy design where every discovered test definition gets a new historical version row every time test names or files change.

## Recommended Migration Direction

The clean migration path from the current implementation is:

1. rename `process_specs` to `step_specs`
2. rename `run_requests` to `runs`
3. rename current `runs` to `step_runs`
4. rename `run_processes` to `process_runs`
5. keep `processes` as the stable process catalog
6. move `path_prefixes` into `repo_areas` instead of keeping them only in config memory
7. add step snapshot fields onto `step_runs`
8. add process snapshot fields onto `process_runs`
9. keep `process_id` foreign keys in `process_runs` and `observations` only as optional links to current catalog rows

That would make the stored schema match the product language much more directly.

## The Short Version

The clean Verge data model should be:

- `step_specs` = current reusable step definitions
- `processes` = current stable process catalog
- `runs` = one whole evaluation for a commit, PR event, or manual trigger
- `step_runs` = one execution of a step in a run, with a step snapshot
- `process_runs` = one execution of a process in a step, with a process snapshot

That is the most durable and least storage-wasteful shape for Verge.
