import { Kysely, PostgresDialect, sql, type Generated, type Selectable } from "kysely";
import pg from "pg";

import { determineFreshnessBucket } from "@verge/core";

import { runMigrations } from "./migrations.js";

const { Pool } = pg;

type Json = unknown;

type RepositoriesTable = {
  id: string;
  slug: string;
  display_name: string;
  root_path: string;
  default_branch: string;
  created_at: Generated<Date>;
};

type RepoAreasTable = {
  id: string;
  repository_id: string;
  key: string;
  display_name: string;
  path_prefixes: Json;
  created_at: Generated<Date>;
};

type StepSpecsTable = {
  id: string;
  repository_id: string;
  key: string;
  display_name: string;
  description: string;
  kind: string;
  base_command: Json;
  cwd: string;
  observed_area_keys: Json;
  materialization: Json;
  reuse_enabled: boolean;
  checkpoint_enabled: boolean;
  always_run: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
};

type ProcessesTable = {
  id: string;
  step_spec_id: string;
  key: string;
  display_name: string;
  kind: string;
  file_path: string | null;
  metadata: Json;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
};

type EventIngestionsTable = {
  id: string;
  repository_id: string;
  source: string;
  delivery_id: string;
  event_name: string;
  payload: Json;
  created_at: Generated<Date>;
};

type RunsTable = {
  id: string;
  repository_id: string;
  event_ingestion_id: string | null;
  trigger: string;
  commit_sha: string;
  branch: string | null;
  pull_request_number: number | null;
  changed_files: Json;
  status: string;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
};

type StepRunsTable = {
  id: string;
  run_id: string;
  step_spec_id: string | null;
  step_key: string;
  display_name: string;
  kind: string;
  base_command: Json;
  cwd: string;
  observed_area_keys: Json;
  materialization: Json;
  checkpoint_enabled: boolean;
  config_fingerprint: string;
  fingerprint: string;
  status: string;
  plan_reason: string;
  reused_from_step_run_id: string | null;
  checkpoint_source_step_run_id: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
};

type ProcessRunsTable = {
  id: string;
  step_run_id: string;
  process_id: string | null;
  process_key: string;
  display_name: string;
  kind: string;
  file_path: string | null;
  metadata: Json;
  selection_payload: Json;
  status: string;
  attempt_count: number;
  claimed_by: string | null;
  lease_expires_at: Date | null;
  last_heartbeat_at: Date | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
};

type CommitProcessStateTable = {
  repository_id: string;
  commit_sha: string;
  step_key: string;
  step_display_name: string;
  step_kind: string;
  process_key: string;
  process_display_name: string;
  process_kind: string;
  file_path: string | null;
  selected_run_id: string;
  selected_step_run_id: string;
  selected_process_run_id: string;
  status: string;
  duration_ms: number | null;
  reused: boolean;
  attempt_count: number;
  updated_at: Generated<Date>;
};

type RunEventsTable = {
  id: string;
  step_run_id: string;
  process_run_id: string | null;
  kind: string;
  message: string;
  payload: Json;
  created_at: Generated<Date>;
};

type ObservationsTable = {
  id: string;
  step_run_id: string;
  process_run_id: string | null;
  process_id: string | null;
  process_key: string | null;
  area_key: string | null;
  status: string;
  summary: Json;
  execution_scope: Json;
  observed_at: Generated<Date>;
};

type ArtifactsTable = {
  id: string;
  step_run_id: string;
  process_run_id: string | null;
  artifact_key: string;
  storage_path: string;
  media_type: string;
  metadata: Json;
  created_at: Generated<Date>;
};

type CheckpointsTable = {
  id: string;
  step_run_id: string;
  step_spec_id: string | null;
  step_key: string;
  fingerprint: string;
  completed_process_keys: Json;
  pending_process_keys: Json;
  storage_path: string | null;
  created_at: Generated<Date>;
  resumable_until: Date;
};

type RepoAreaStateTable = {
  repo_area_id: string;
  latest_status: string;
  freshness_bucket: string;
  last_observed_at: Date | null;
  last_successful_observed_at: Date | null;
  updated_at: Generated<Date>;
};

export type VergeDatabase = {
  repositories: RepositoriesTable;
  repo_areas: RepoAreasTable;
  step_specs: StepSpecsTable;
  processes: ProcessesTable;
  event_ingestions: EventIngestionsTable;
  runs: RunsTable;
  step_runs: StepRunsTable;
  process_runs: ProcessRunsTable;
  commit_process_state: CommitProcessStateTable;
  run_events: RunEventsTable;
  observations: ObservationsTable;
  artifacts: ArtifactsTable;
  checkpoints: CheckpointsTable;
  repo_area_state: RepoAreaStateTable;
};

export type DatabaseConnection = {
  db: Kysely<VergeDatabase>;
  pool: pg.Pool;
};

export type DatabaseExecutor = Kysely<VergeDatabase>;

export type RepositoryRow = Selectable<RepositoriesTable>;
export type StepSpecRow = Selectable<StepSpecsTable>;
export type ProcessRow = Selectable<ProcessesTable>;
export type EventIngestionRow = Selectable<EventIngestionsTable>;
export type RunRow = Selectable<RunsTable>;
export type StepRunRow = Selectable<StepRunsTable>;
export type ProcessRunRow = Selectable<ProcessRunsTable>;
export type CommitProcessStateRow = Selectable<CommitProcessStateTable>;
export type ObservationRow = Selectable<ObservationsTable>;
export type ArtifactRow = Selectable<ArtifactsTable>;
export type CheckpointRow = Selectable<CheckpointsTable>;

export const DEFAULT_DATABASE_URL = "postgres://verge:verge@127.0.0.1:54329/verge";

export const createDatabaseConnection = (
  databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): DatabaseConnection => {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = new Kysely<VergeDatabase>({
    dialect: new PostgresDialect({ pool }),
  });

  return { db, pool };
};

export const destroyDatabaseConnection = async (connection: DatabaseConnection): Promise<void> => {
  try {
    await connection.db.destroy();
  } catch (error) {
    if (error instanceof Error && error.message.includes("Called end on pool more than once")) {
      return;
    }

    throw error;
  }
};

export const migrateDatabase = async (db: Kysely<VergeDatabase>): Promise<void> => {
  await runMigrations(db);
};

export const json = (value: unknown): string => JSON.stringify(value);

export const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export const durationMsBetween = (
  startedAt: Date | null,
  finishedAt: Date | null,
): number | null => {
  if (!startedAt || !finishedAt) {
    return null;
  }

  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
};

export const coalesceDurationMs = (
  storedDurationMs: number | null,
  startedAt: Date | null,
  finishedAt: Date | null,
): number | null => storedDurationMs ?? durationMsBetween(startedAt, finishedAt);

export const parseJson = <T>(value: unknown): T => {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value as T;
};

export const summarizeStatuses = (
  statuses: string[],
): "queued" | "running" | "passed" | "failed" | "reused" | "interrupted" => {
  if (statuses.length === 0) {
    return "queued";
  }

  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (statuses.some((status) => status === "interrupted")) {
    return "interrupted";
  }

  if (statuses.some((status) => status === "running" || status === "claimed")) {
    return "running";
  }

  if (statuses.some((status) => status === "queued")) {
    return "queued";
  }

  if (statuses.every((status) => status === "reused")) {
    return "reused";
  }

  return "passed";
};

export const syncRepoAreaState = async (
  db: Kysely<VergeDatabase>,
  runId: string,
  input: {
    areaKey: string;
    status: string;
    observedAt?: Date;
  },
): Promise<void> => {
  const repoArea = await db
    .selectFrom("repo_areas")
    .innerJoin("runs", "runs.repository_id", "repo_areas.repository_id")
    .select(["repo_areas.id as repoAreaId"])
    .where("runs.id", "=", runId)
    .where("repo_areas.key", "=", input.areaKey)
    .executeTakeFirst();

  if (!repoArea) {
    return;
  }

  const observedAt = input.observedAt ?? new Date();
  await db
    .updateTable("repo_area_state")
    .set({
      latest_status: input.status,
      freshness_bucket: determineFreshnessBucket(observedAt, observedAt),
      last_observed_at: observedAt,
      last_successful_observed_at:
        input.status === "passed" || input.status === "reused"
          ? observedAt
          : sql`last_successful_observed_at`,
      updated_at: observedAt,
    })
    .where("repo_area_id", "=", repoArea.repoAreaId)
    .execute();
};
