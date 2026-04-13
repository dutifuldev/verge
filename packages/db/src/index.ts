import { randomUUID } from "node:crypto";

import { Kysely, PostgresDialect, sql, type Generated, type Selectable } from "kysely";
import pg from "pg";

import type {
  AppendRunEventInput,
  ClaimedProcessRun,
  CommitDetail,
  PaginatedRunList,
  PullRequestDetail,
  RecordArtifactInput,
  RecordCheckpointInput,
  RecordObservationInput,
  RepositoryDefinition,
  RepositoryHealth,
  RunDetail,
  RunListItem,
  RunListQuery,
  RunTrigger,
  StepRunDetail,
  StepRunSummary,
  StepSpec,
  StepSpecSummary,
} from "@verge/contracts";
import { determineFreshnessBucket, materializeProcesses } from "@verge/core";

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

const json = (value: unknown): string => JSON.stringify(value);

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const parseJson = <T>(value: unknown): T => {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
};

const summarizeStatuses = (
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

const syncRepoAreaState = async (
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

export const syncRepositoryConfiguration = async (
  db: Kysely<VergeDatabase>,
  repository: RepositoryDefinition,
  stepSpecs: StepSpec[],
): Promise<Selectable<RepositoriesTable>> => {
  const repositoryRecord = await db
    .insertInto("repositories")
    .values({
      id: randomUUID(),
      slug: repository.slug,
      display_name: repository.displayName,
      root_path: repository.rootPath,
      default_branch: repository.defaultBranch,
    })
    .onConflict((oc) =>
      oc.column("slug").doUpdateSet({
        display_name: repository.displayName,
        root_path: repository.rootPath,
        default_branch: repository.defaultBranch,
      }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  const areaKeys = repository.areas.map((area) => area.key);
  for (const area of repository.areas) {
    const repoArea = await db
      .insertInto("repo_areas")
      .values({
        id: randomUUID(),
        repository_id: repositoryRecord.id,
        key: area.key,
        display_name: area.displayName,
        path_prefixes: json(area.pathPrefixes),
      })
      .onConflict((oc) =>
        oc.columns(["repository_id", "key"]).doUpdateSet({
          display_name: area.displayName,
          path_prefixes: json(area.pathPrefixes),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("repo_area_state")
      .values({
        repo_area_id: repoArea.id,
        latest_status: "unknown",
        freshness_bucket: "unknown",
        last_observed_at: null,
        last_successful_observed_at: null,
      })
      .onConflict((oc) => oc.column("repo_area_id").doNothing())
      .execute();
  }

  let deleteAreas = db.deleteFrom("repo_areas").where("repository_id", "=", repositoryRecord.id);
  if (areaKeys.length > 0) {
    deleteAreas = deleteAreas.where("key", "not in", areaKeys);
  }
  await deleteAreas.execute();

  const stepKeys = stepSpecs.map((stepSpec) => stepSpec.key);

  for (const stepSpec of stepSpecs) {
    const stepSpecRecord = await db
      .insertInto("step_specs")
      .values({
        id: randomUUID(),
        repository_id: repositoryRecord.id,
        key: stepSpec.key,
        display_name: stepSpec.displayName,
        description: stepSpec.description,
        kind: stepSpec.kind,
        base_command: json(stepSpec.baseCommand),
        cwd: stepSpec.cwd,
        observed_area_keys: json(stepSpec.observedAreaKeys),
        materialization: json(stepSpec.materialization),
        reuse_enabled: stepSpec.reuseEnabled,
        checkpoint_enabled: stepSpec.checkpointEnabled,
        always_run: stepSpec.alwaysRun,
      })
      .onConflict((oc) =>
        oc.columns(["repository_id", "key"]).doUpdateSet({
          display_name: stepSpec.displayName,
          description: stepSpec.description,
          kind: stepSpec.kind,
          base_command: json(stepSpec.baseCommand),
          cwd: stepSpec.cwd,
          observed_area_keys: json(stepSpec.observedAreaKeys),
          materialization: json(stepSpec.materialization),
          reuse_enabled: stepSpec.reuseEnabled,
          checkpoint_enabled: stepSpec.checkpointEnabled,
          always_run: stepSpec.alwaysRun,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    const materializedProcesses = await materializeProcesses(stepSpec);
    const processKeys = materializedProcesses.map((process) => process.key);

    for (const process of materializedProcesses) {
      await db
        .insertInto("processes")
        .values({
          id: randomUUID(),
          step_spec_id: stepSpecRecord.id,
          key: process.key,
          display_name: process.displayName,
          kind: process.kind,
          file_path: process.filePath ?? null,
          metadata: json({
            areaKeys: process.areaKeys,
            command: process.command,
          }),
        })
        .onConflict((oc) =>
          oc.columns(["step_spec_id", "key"]).doUpdateSet({
            display_name: process.displayName,
            kind: process.kind,
            file_path: process.filePath ?? null,
            metadata: json({
              areaKeys: process.areaKeys,
              command: process.command,
            }),
            updated_at: new Date(),
          }),
        )
        .execute();
    }

    let deleteProcesses = db.deleteFrom("processes").where("step_spec_id", "=", stepSpecRecord.id);
    if (processKeys.length > 0) {
      deleteProcesses = deleteProcesses.where("key", "not in", processKeys);
    }
    await deleteProcesses.execute();
  }

  let deleteSteps = db.deleteFrom("step_specs").where("repository_id", "=", repositoryRecord.id);
  if (stepKeys.length > 0) {
    deleteSteps = deleteSteps.where("key", "not in", stepKeys);
  }
  await deleteSteps.execute();

  return repositoryRecord;
};

export const getRepositoryBySlug = async (
  db: Kysely<VergeDatabase>,
  slug: string,
): Promise<Selectable<RepositoriesTable> | undefined> =>
  db.selectFrom("repositories").selectAll().where("slug", "=", slug).executeTakeFirst();

export const getStepSpecsForRepository = async (
  db: Kysely<VergeDatabase>,
  repositoryId: string,
): Promise<
  Array<
    Selectable<StepSpecsTable> & {
      parsed_step_spec: StepSpec;
    }
  >
> => {
  const rows = await db
    .selectFrom("step_specs")
    .selectAll()
    .where("repository_id", "=", repositoryId)
    .orderBy("key", "asc")
    .execute();

  return rows.map((row) => ({
    ...row,
    parsed_step_spec: {
      key: row.key,
      displayName: row.display_name,
      description: row.description,
      kind: row.kind,
      baseCommand: parseJson<string[]>(row.base_command),
      cwd: row.cwd,
      observedAreaKeys: parseJson<string[]>(row.observed_area_keys),
      materialization: parseJson<StepSpec["materialization"]>(row.materialization),
      reuseEnabled: row.reuse_enabled,
      checkpointEnabled: row.checkpoint_enabled,
      alwaysRun: row.always_run,
    },
  }));
};

export const listStepSpecSummaries = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
): Promise<StepSpecSummary[]> => {
  const rows = await db
    .selectFrom("step_specs")
    .innerJoin("repositories", "repositories.id", "step_specs.repository_id")
    .select([
      "step_specs.id",
      "repositories.slug as repositorySlug",
      "step_specs.key",
      "step_specs.display_name as displayName",
      "step_specs.description",
      "step_specs.kind",
      "step_specs.base_command as baseCommand",
      "step_specs.cwd",
      "step_specs.observed_area_keys as observedAreaKeys",
      "step_specs.materialization",
      "step_specs.reuse_enabled as reuseEnabled",
      "step_specs.checkpoint_enabled as checkpointEnabled",
      "step_specs.always_run as alwaysRun",
    ])
    .where("repositories.slug", "=", repositorySlug)
    .orderBy("step_specs.key", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    repositorySlug: row.repositorySlug,
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    kind: row.kind,
    baseCommand: parseJson<string[]>(row.baseCommand),
    cwd: row.cwd,
    observedAreaKeys: parseJson<string[]>(row.observedAreaKeys),
    materialization: parseJson<StepSpec["materialization"]>(row.materialization),
    reuseEnabled: row.reuseEnabled,
    checkpointEnabled: row.checkpointEnabled,
    alwaysRun: row.alwaysRun,
  }));
};

export const createEventIngestion = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    source: string;
    deliveryId: string;
    eventName: string;
    payload: unknown;
  },
): Promise<{
  eventIngestion: Selectable<EventIngestionsTable>;
  inserted: boolean;
}> => {
  const inserted = await db
    .insertInto("event_ingestions")
    .values({
      id: randomUUID(),
      repository_id: input.repositoryId,
      source: input.source,
      delivery_id: input.deliveryId,
      event_name: input.eventName,
      payload: json(input.payload),
    })
    .onConflict((oc) => oc.columns(["repository_id", "source", "delivery_id"]).doNothing())
    .returningAll()
    .executeTakeFirst();

  if (inserted) {
    return {
      eventIngestion: inserted,
      inserted: true,
    };
  }

  const existing = await db
    .selectFrom("event_ingestions")
    .selectAll()
    .where("repository_id", "=", input.repositoryId)
    .where("source", "=", input.source)
    .where("delivery_id", "=", input.deliveryId)
    .executeTakeFirstOrThrow();

  return {
    eventIngestion: existing,
    inserted: false,
  };
};

export const createRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    trigger: RunTrigger;
    commitSha: string;
    changedFiles: string[];
    branch?: string;
    pullRequestNumber?: number;
    eventIngestionId?: string;
    status?: string;
  },
): Promise<Selectable<RunsTable>> =>
  db
    .insertInto("runs")
    .values({
      id: randomUUID(),
      repository_id: input.repositoryId,
      event_ingestion_id: input.eventIngestionId ?? null,
      trigger: input.trigger,
      commit_sha: input.commitSha,
      branch: input.branch ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      changed_files: json(input.changedFiles),
      status: input.status ?? "queued",
      started_at: null,
      finished_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const createStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    runId: string;
    stepSpecId?: string | null;
    stepSpec: StepSpec;
    configFingerprint: string;
    fingerprint: string;
    status: string;
    planReason: string;
    reusedFromStepRunId?: string | null;
    checkpointSourceStepRunId?: string | null;
  },
): Promise<Selectable<StepRunsTable>> => {
  const now = new Date();
  return db
    .insertInto("step_runs")
    .values({
      id: randomUUID(),
      run_id: input.runId,
      step_spec_id: input.stepSpecId ?? null,
      step_key: input.stepSpec.key,
      display_name: input.stepSpec.displayName,
      kind: input.stepSpec.kind,
      base_command: json(input.stepSpec.baseCommand),
      cwd: input.stepSpec.cwd,
      observed_area_keys: json(input.stepSpec.observedAreaKeys),
      materialization: json(input.stepSpec.materialization),
      checkpoint_enabled: input.stepSpec.checkpointEnabled,
      config_fingerprint: input.configFingerprint,
      fingerprint: input.fingerprint,
      status: input.status,
      plan_reason: input.planReason,
      reused_from_step_run_id: input.reusedFromStepRunId ?? null,
      checkpoint_source_step_run_id: input.checkpointSourceStepRunId ?? null,
      started_at: input.status === "running" ? now : null,
      finished_at:
        input.status === "passed" || input.status === "failed" || input.status === "reused"
          ? now
          : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
};

export const createProcessRuns = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processes: Array<{
      processId?: string | null;
      processKey: string;
      displayName: string;
      kind: string;
      filePath?: string | null;
      metadata?: Record<string, unknown>;
      selectionPayload: unknown;
      status?: string;
      attemptCount?: number;
    }>;
  },
): Promise<Array<Selectable<ProcessRunsTable>>> => {
  if (input.processes.length === 0) {
    return [];
  }

  return db
    .insertInto("process_runs")
    .values(
      input.processes.map((processRun) => ({
        id: randomUUID(),
        step_run_id: input.stepRunId,
        process_id: processRun.processId ?? null,
        process_key: processRun.processKey,
        display_name: processRun.displayName,
        kind: processRun.kind,
        file_path: processRun.filePath ?? null,
        metadata: json(processRun.metadata ?? {}),
        selection_payload: json(processRun.selectionPayload),
        status: processRun.status ?? "queued",
        attempt_count: processRun.attemptCount ?? 0,
        created_at: new Date(),
      })),
    )
    .returningAll()
    .execute();
};

export const listProcessRuns = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<Array<Selectable<ProcessRunsTable>>> =>
  db
    .selectFrom("process_runs")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();

export const processRunBelongsToStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processRunId: string;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("process_runs")
    .select("id")
    .where("id", "=", input.processRunId)
    .where("step_run_id", "=", input.stepRunId)
    .executeTakeFirst();

  return Boolean(row);
};

export const processRunLeaseIsActive = async (
  db: Kysely<VergeDatabase>,
  input: {
    stepRunId: string;
    processRunId: string;
    workerId: string;
    now?: Date;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("process_runs")
    .select("id")
    .where("id", "=", input.processRunId)
    .where("step_run_id", "=", input.stepRunId)
    .where("claimed_by", "=", input.workerId)
    .where("lease_expires_at", ">", input.now ?? new Date())
    .where("status", "in", ["claimed", "running"])
    .executeTakeFirst();

  return Boolean(row);
};

export const findReusableStepRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    stepKey: string;
    fingerprint: string;
    stepSpecId?: string | null;
  },
): Promise<Selectable<StepRunsTable> | undefined> => {
  let query = db
    .selectFrom("step_runs")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .selectAll("step_runs")
    .where("runs.repository_id", "=", input.repositoryId)
    .where("step_runs.step_key", "=", input.stepKey)
    .where("step_runs.fingerprint", "=", input.fingerprint)
    .where((eb) => eb("step_runs.status", "=", "passed").or("step_runs.status", "=", "reused"))
    .orderBy("step_runs.created_at", "desc");

  if (input.stepSpecId) {
    query = query.where("step_runs.step_spec_id", "=", input.stepSpecId);
  }

  return query.executeTakeFirst();
};

export const findLatestCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    stepKey: string;
    fingerprint: string;
    stepSpecId?: string | null;
    now?: Date;
  },
): Promise<Selectable<CheckpointsTable> | undefined> => {
  let query = db
    .selectFrom("checkpoints")
    .innerJoin("step_runs", "step_runs.id", "checkpoints.step_run_id")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .selectAll("checkpoints")
    .where("runs.repository_id", "=", input.repositoryId)
    .where("checkpoints.step_key", "=", input.stepKey)
    .where("checkpoints.fingerprint", "=", input.fingerprint)
    .where("checkpoints.resumable_until", ">", input.now ?? new Date())
    .orderBy("checkpoints.created_at", "desc");

  if (input.stepSpecId) {
    query = query.where("checkpoints.step_spec_id", "=", input.stepSpecId);
  }

  return query.executeTakeFirst();
};

export const cloneStepRunForReuse = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceStepRunId: string;
    newStepRunId: string;
  },
): Promise<void> => {
  const sourceProcesses = await listProcessRuns(db, input.sourceStepRunId);
  if (sourceProcesses.length > 0) {
    await createProcessRuns(db, {
      stepRunId: input.newStepRunId,
      processes: sourceProcesses.map((process) => ({
        processId: process.process_id,
        processKey: process.process_key,
        displayName: process.display_name,
        kind: process.kind,
        filePath: process.file_path,
        metadata: parseJson<Record<string, unknown>>(process.metadata),
        selectionPayload: parseJson(process.selection_payload),
        status: "reused",
        attemptCount: process.attempt_count,
      })),
    });
  }

  const sourceObservations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .execute();

  if (sourceObservations.length === 0) {
    return;
  }

  const runId = await db
    .selectFrom("step_runs")
    .select("run_id")
    .where("id", "=", input.newStepRunId)
    .executeTakeFirstOrThrow();

  const observedAt = new Date();
  await db
    .insertInto("observations")
    .values(
      sourceObservations.map((observation) => ({
        id: randomUUID(),
        step_run_id: input.newStepRunId,
        process_run_id: null,
        process_id: observation.process_id,
        process_key: observation.process_key,
        area_key: observation.area_key,
        status: observation.status,
        summary: observation.summary,
        execution_scope: observation.execution_scope,
        observed_at: observedAt,
      })),
    )
    .execute();

  for (const observation of sourceObservations) {
    if (observation.area_key) {
      await syncRepoAreaState(db, runId.run_id, {
        areaKey: observation.area_key,
        status: observation.status,
        observedAt,
      });
    }
  }
};

export const cloneCompletedProcessesFromCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceStepRunId: string;
    newStepRunId: string;
    completedProcessKeys: string[];
  },
): Promise<void> => {
  if (input.completedProcessKeys.length === 0) {
    return;
  }

  const sourceProcesses = await db
    .selectFrom("process_runs")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  await createProcessRuns(db, {
    stepRunId: input.newStepRunId,
    processes: sourceProcesses.map((process) => ({
      processId: process.process_id,
      processKey: process.process_key,
      displayName: process.display_name,
      kind: process.kind,
      filePath: process.file_path,
      metadata: parseJson<Record<string, unknown>>(process.metadata),
      selectionPayload: parseJson(process.selection_payload),
      status: "reused",
      attemptCount: process.attempt_count,
    })),
  });

  const sourceObservations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", input.sourceStepRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  if (sourceObservations.length === 0) {
    return;
  }

  const runId = await db
    .selectFrom("step_runs")
    .select("run_id")
    .where("id", "=", input.newStepRunId)
    .executeTakeFirstOrThrow();

  const observedAt = new Date();
  await db
    .insertInto("observations")
    .values(
      sourceObservations.map((observation) => ({
        id: randomUUID(),
        step_run_id: input.newStepRunId,
        process_run_id: null,
        process_id: observation.process_id,
        process_key: observation.process_key,
        area_key: observation.area_key,
        status: observation.status,
        summary: observation.summary,
        execution_scope: observation.execution_scope,
        observed_at: observedAt,
      })),
    )
    .execute();

  for (const observation of sourceObservations) {
    if (observation.area_key) {
      await syncRepoAreaState(db, runId.run_id, {
        areaKey: observation.area_key,
        status: observation.status,
        observedAt,
      });
    }
  }
};

export const interruptPendingProcessesForStepRun = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<void> => {
  const updated = await db
    .updateTable("process_runs")
    .set({
      status: "interrupted",
      finished_at: new Date(),
      claimed_by: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    })
    .where("step_run_id", "=", stepRunId)
    .where("status", "in", ["queued", "claimed", "running"])
    .returning("id")
    .execute();

  if (updated.length > 0) {
    await refreshStepRunStatus(db, stepRunId);
  }
};

const expireLeases = async (db: Kysely<VergeDatabase>, now = new Date()): Promise<void> => {
  await db
    .updateTable("process_runs")
    .set({
      status: "queued",
      claimed_by: null,
      lease_expires_at: null,
    })
    .where("status", "in", ["claimed", "running"])
    .where("lease_expires_at", "<", now)
    .execute();
};

export const claimNextProcessRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<ClaimedProcessRun | null> =>
  db.transaction().execute(async (trx) => {
    await expireLeases(trx);

    const candidate = await trx
      .selectFrom("process_runs")
      .innerJoin("step_runs", "step_runs.id", "process_runs.step_run_id")
      .innerJoin("runs", "runs.id", "step_runs.run_id")
      .innerJoin("repositories", "repositories.id", "runs.repository_id")
      .select([
        "process_runs.id as processRunId",
        "process_runs.step_run_id as stepRunId",
        "process_runs.process_key as processKey",
        "process_runs.display_name as processDisplayName",
        "process_runs.kind as processKind",
        "process_runs.metadata as processMetadata",
        "process_runs.selection_payload as selectionPayload",
        "runs.id as runId",
        "repositories.slug as repositorySlug",
        "repositories.root_path as repositoryRootPath",
        "step_runs.step_key as stepKey",
        "step_runs.display_name as stepDisplayName",
        "step_runs.kind as stepKind",
        "step_runs.checkpoint_enabled as checkpointEnabled",
        "step_runs.base_command as baseCommand",
      ])
      .where("process_runs.status", "=", "queued")
      .orderBy("process_runs.created_at", "asc")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!candidate) {
      return null;
    }

    const leaseExpiresAt = new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000);
    const claimed = await trx
      .updateTable("process_runs")
      .set({
        status: "claimed",
        claimed_by: input.workerId,
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: new Date(),
      })
      .where("id", "=", candidate.processRunId)
      .where("status", "=", "queued")
      .returning("id")
      .executeTakeFirst();

    if (!claimed) {
      return null;
    }

    return {
      runId: candidate.runId,
      stepRunId: candidate.stepRunId,
      processRunId: candidate.processRunId,
      repositorySlug: candidate.repositorySlug,
      repositoryRootPath: candidate.repositoryRootPath,
      stepKey: candidate.stepKey,
      stepDisplayName: candidate.stepDisplayName,
      stepKind: candidate.stepKind,
      processKey: candidate.processKey,
      processDisplayName: candidate.processDisplayName,
      processKind: candidate.processKind,
      areaKeys:
        parseJson<{ areaKeys?: string[] }>(candidate.processMetadata).areaKeys?.filter(
          (value): value is string => typeof value === "string",
        ) ?? [],
      command: [
        ...parseJson<string[]>(candidate.baseCommand),
        ...(parseJson<{ command?: string[] }>(candidate.selectionPayload).command ?? []),
      ],
      checkpointEnabled: candidate.checkpointEnabled,
    };
  });

export const heartbeatProcessRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    processRunId: string;
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<void> => {
  await db
    .updateTable("process_runs")
    .set({
      last_heartbeat_at: new Date(),
      claimed_by: input.workerId,
      lease_expires_at: new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000),
    })
    .where("id", "=", input.processRunId)
    .execute();
};

export const refreshRunStatus = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<Selectable<RunsTable> | undefined> => {
  const stepRows = await db
    .selectFrom("step_runs")
    .select(["status", "started_at", "finished_at"])
    .where("run_id", "=", runId)
    .execute();

  if (stepRows.length === 0) {
    return db.selectFrom("runs").selectAll().where("id", "=", runId).executeTakeFirst();
  }

  const status = summarizeStatuses(stepRows.map((row) => row.status));
  const startedCandidates = stepRows
    .map((row) => row.started_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  const finishedCandidates = stepRows
    .map((row) => row.finished_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());

  const updated = await db
    .updateTable("runs")
    .set({
      status,
      started_at: startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null,
      finished_at:
        finishedCandidates.length === stepRows.length && finishedCandidates.length > 0
          ? new Date(Math.max(...finishedCandidates))
          : null,
    })
    .where("id", "=", runId)
    .returningAll()
    .executeTakeFirst();

  return updated;
};

export const refreshStepRunStatus = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<Selectable<StepRunsTable> | undefined> => {
  const processRows = await listProcessRuns(db, stepRunId);
  if (processRows.length === 0) {
    return db.selectFrom("step_runs").selectAll().where("id", "=", stepRunId).executeTakeFirst();
  }

  const status = summarizeStatuses(processRows.map((process) => process.status));
  const startedCandidates = processRows
    .map((process) => process.started_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());
  const finishedCandidates = processRows
    .map((process) => process.finished_at)
    .filter((value): value is Date => Boolean(value))
    .map((value) => value.getTime());

  const updated = await db
    .updateTable("step_runs")
    .set({
      status,
      started_at: startedCandidates.length ? new Date(Math.min(...startedCandidates)) : null,
      finished_at:
        finishedCandidates.length === processRows.length && finishedCandidates.length > 0
          ? new Date(Math.max(...finishedCandidates))
          : null,
    })
    .where("id", "=", stepRunId)
    .returningAll()
    .executeTakeFirst();

  if (updated) {
    await refreshRunStatus(db, updated.run_id);
  }

  return updated;
};

export const recordRunEvent = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: AppendRunEventInput,
): Promise<void> => {
  await db
    .insertInto("run_events")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      kind: input.kind,
      message: input.message,
      payload: json(input.payload ?? {}),
    })
    .execute();

  if (!input.processRunId) {
    return;
  }

  if (input.kind === "started") {
    await db
      .updateTable("process_runs")
      .set({
        status: "running",
        started_at: new Date(),
        attempt_count: sql`attempt_count + 1`,
      })
      .where("id", "=", input.processRunId)
      .execute();

    await db
      .updateTable("step_runs")
      .set({
        status: "running",
        started_at: sql`coalesce(started_at, now())`,
      })
      .where("id", "=", stepRunId)
      .execute();

    const row = await db
      .selectFrom("step_runs")
      .select("run_id")
      .where("id", "=", stepRunId)
      .executeTakeFirst();

    if (row) {
      await db
        .updateTable("runs")
        .set({
          status: "running",
          started_at: sql`coalesce(started_at, now())`,
        })
        .where("id", "=", row.run_id)
        .execute();
    }
  }

  if (input.kind === "passed" || input.kind === "failed" || input.kind === "interrupted") {
    await db
      .updateTable("process_runs")
      .set({
        status: input.kind === "passed" ? "passed" : input.kind,
        finished_at: new Date(),
      })
      .where("id", "=", input.processRunId)
      .execute();

    await refreshStepRunStatus(db, stepRunId);
  }
};

export const recordObservation = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: RecordObservationInput,
): Promise<void> => {
  const stepRun = await db
    .selectFrom("step_runs")
    .select(["run_id"])
    .where("id", "=", stepRunId)
    .executeTakeFirstOrThrow();

  await db
    .insertInto("observations")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      process_id: null,
      process_key: input.processKey ?? null,
      area_key: input.areaKey ?? null,
      status: input.status,
      summary: json(input.summary),
      execution_scope: json(input.executionScope),
    })
    .execute();

  if (input.areaKey) {
    await syncRepoAreaState(db, stepRun.run_id, {
      areaKey: input.areaKey,
      status: input.status,
    });
  }
};

export const recordArtifact = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: RecordArtifactInput,
): Promise<void> => {
  await db
    .insertInto("artifacts")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      process_run_id: input.processRunId ?? null,
      artifact_key: input.artifactKey,
      storage_path: input.storagePath,
      media_type: input.mediaType,
      metadata: json(input.metadata),
    })
    .execute();
};

export const recordCheckpoint = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
  input: {
    stepSpecId?: string | null;
    stepKey: string;
    fingerprint: string;
    checkpoint: RecordCheckpointInput;
  },
): Promise<void> => {
  await db
    .insertInto("checkpoints")
    .values({
      id: randomUUID(),
      step_run_id: stepRunId,
      step_spec_id: input.stepSpecId ?? null,
      step_key: input.stepKey,
      fingerprint: input.fingerprint,
      completed_process_keys: json(input.checkpoint.completedProcessKeys),
      pending_process_keys: json(input.checkpoint.pendingProcessKeys),
      storage_path: input.checkpoint.storagePath ?? null,
      resumable_until: new Date(input.checkpoint.resumableUntil),
    })
    .execute();
};

const selectStepRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("step_runs")
    .innerJoin("runs", "runs.id", "step_runs.run_id")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select([
      "step_runs.id as stepRunId",
      "step_runs.run_id as runId",
      "step_runs.step_key as stepKey",
      "step_runs.display_name as stepDisplayName",
      "step_runs.kind as stepKind",
      "step_runs.status as stepStatus",
      "step_runs.plan_reason as planReason",
      "step_runs.reused_from_step_run_id as reusedFromStepRunId",
      "step_runs.checkpoint_source_step_run_id as checkpointSourceStepRunId",
      "step_runs.created_at as stepCreatedAt",
      "step_runs.started_at as stepStartedAt",
      "step_runs.finished_at as stepFinishedAt",
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const selectRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select([
      "runs.id as id",
      "repositories.slug as repositorySlug",
      "runs.trigger as trigger",
      "runs.commit_sha as commitSha",
      "runs.branch as branch",
      "runs.pull_request_number as pullRequestNumber",
      "runs.changed_files as changedFiles",
      "runs.status as status",
      "runs.created_at as createdAt",
      "runs.started_at as startedAt",
      "runs.finished_at as finishedAt",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const toStepRunSummary = async (
  db: Kysely<VergeDatabase>,
  row: Awaited<ReturnType<ReturnType<typeof selectStepRunRows>["executeTakeFirst"]>>,
): Promise<StepRunSummary> => {
  if (!row) {
    throw new Error("Missing step run row");
  }

  const processRuns = await listProcessRuns(db, row.stepRunId);

  return {
    id: row.stepRunId,
    runId: row.runId,
    stepKey: row.stepKey,
    stepDisplayName: row.stepDisplayName,
    stepKind: row.stepKind,
    status: row.stepStatus as StepRunSummary["status"],
    planReason: row.planReason,
    reusedFromStepRunId: row.reusedFromStepRunId,
    checkpointSourceStepRunId: row.checkpointSourceStepRunId,
    createdAt: row.stepCreatedAt.toISOString(),
    startedAt: iso(row.stepStartedAt),
    finishedAt: iso(row.stepFinishedAt),
    processCount: processRuns.length,
  };
};

export const getStepRunDetail = async (
  db: Kysely<VergeDatabase>,
  stepRunId: string,
): Promise<StepRunDetail | null> => {
  const row = await selectStepRunRows(db).where("step_runs.id", "=", stepRunId).executeTakeFirst();
  if (!row) {
    return null;
  }
  const summary = await toStepRunSummary(db, row);
  const processRuns = await listProcessRuns(db, stepRunId);
  const observations = await db
    .selectFrom("observations")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("observed_at", "asc")
    .execute();
  const events = await db
    .selectFrom("run_events")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();
  const artifacts = await db
    .selectFrom("artifacts")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();
  const checkpoints = await db
    .selectFrom("checkpoints")
    .selectAll()
    .where("step_run_id", "=", stepRunId)
    .orderBy("created_at", "asc")
    .execute();

  return {
    ...summary,
    processes: processRuns.map((process) => ({
      id: process.id,
      processKey: process.process_key,
      processDisplayName: process.display_name,
      processKind: process.kind,
      filePath: process.file_path,
      status: process.status as StepRunDetail["processes"][number]["status"],
      attemptCount: process.attempt_count,
      startedAt: iso(process.started_at),
      finishedAt: iso(process.finished_at),
    })),
    observations: observations.map((observation) => ({
      id: observation.id,
      stepRunId: observation.step_run_id,
      processRunId: observation.process_run_id,
      processKey: observation.process_key,
      areaKey: observation.area_key,
      status: observation.status as StepRunDetail["observations"][number]["status"],
      summary: parseJson<Record<string, unknown>>(observation.summary),
      executionScope: parseJson<Record<string, unknown>>(observation.execution_scope),
      observedAt: observation.observed_at.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      stepRunId: event.step_run_id,
      processRunId: event.process_run_id,
      kind: event.kind,
      message: event.message,
      payload: parseJson<Record<string, unknown>>(event.payload),
      createdAt: event.created_at.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      stepRunId: artifact.step_run_id,
      processRunId: artifact.process_run_id,
      artifactKey: artifact.artifact_key,
      storagePath: artifact.storage_path,
      mediaType: artifact.media_type,
      metadata: parseJson<Record<string, unknown>>(artifact.metadata),
      createdAt: artifact.created_at.toISOString(),
    })),
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      stepRunId: checkpoint.step_run_id,
      completedProcessKeys: parseJson<string[]>(checkpoint.completed_process_keys),
      pendingProcessKeys: parseJson<string[]>(checkpoint.pending_process_keys),
      storagePath: checkpoint.storage_path,
      createdAt: checkpoint.created_at.toISOString(),
      resumableUntil: checkpoint.resumable_until.toISOString(),
    })),
  };
};

export const getRunDetail = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<RunDetail | null> => {
  const run = await selectRunRows(db).where("runs.id", "=", runId).executeTakeFirst();
  if (!run) {
    return null;
  }
  const stepRows = await selectStepRunRows(db)
    .where("step_runs.run_id", "=", runId)
    .orderBy("step_runs.created_at", "asc")
    .execute();
  const steps = await Promise.all(stepRows.map((row) => toStepRunSummary(db, row)));

  return {
    id: run.id,
    repositorySlug: run.repositorySlug,
    trigger: run.trigger as RunTrigger,
    commitSha: run.commitSha,
    branch: run.branch,
    pullRequestNumber: run.pullRequestNumber,
    changedFiles: parseJson<string[]>(run.changedFiles),
    status: run.status as RunDetail["status"],
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    steps,
  };
};

export const listRepositoryRuns = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  query: RunListQuery,
): Promise<PaginatedRunList> => {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, Math.min(100, query.pageSize));
  const offset = (page - 1) * pageSize;

  const rows = await selectRunRows(db, repositorySlug).orderBy("runs.created_at", "desc").execute();

  const summaries = await Promise.all(
    rows.map(async (row): Promise<RunListItem> => {
      const stepRows = await selectStepRunRows(db)
        .where("step_runs.run_id", "=", row.id)
        .orderBy("step_runs.created_at", "asc")
        .execute();
      const steps = await Promise.all(stepRows.map((stepRow) => toStepRunSummary(db, stepRow)));

      return {
        id: row.id,
        repositorySlug: row.repositorySlug,
        trigger: row.trigger as RunTrigger,
        commitSha: row.commitSha,
        branch: row.branch,
        pullRequestNumber: row.pullRequestNumber,
        changedFiles: parseJson<string[]>(row.changedFiles),
        status: row.status as RunListItem["status"],
        createdAt: row.createdAt.toISOString(),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
        steps,
      };
    }),
  );

  const filtered = summaries.filter((summary) => {
    if (query.status && summary.status !== query.status) {
      return false;
    }

    if (query.trigger && summary.trigger !== query.trigger) {
      return false;
    }

    if (query.stepKey && !summary.steps.some((step) => step.stepKey === query.stepKey)) {
      return false;
    }

    return true;
  });

  return {
    page,
    pageSize,
    total: filtered.length,
    items: filtered.slice(offset, offset + pageSize),
  };
};

export const getRepositoryHealth = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
): Promise<RepositoryHealth> => {
  const repository = await db
    .selectFrom("repositories")
    .selectAll()
    .where("slug", "=", repositorySlug)
    .executeTakeFirstOrThrow();
  const runs = await listRepositoryRuns(db, repositorySlug, {
    page: 1,
    pageSize: 12,
  });
  const areaStates = await db
    .selectFrom("repo_area_state")
    .innerJoin("repo_areas", "repo_areas.id", "repo_area_state.repo_area_id")
    .select([
      "repo_areas.key as key",
      "repo_areas.display_name as displayName",
      "repo_area_state.latest_status as latestStatus",
      "repo_area_state.freshness_bucket as freshnessBucket",
      "repo_area_state.last_observed_at as lastObservedAt",
      "repo_area_state.last_successful_observed_at as lastSuccessfulObservedAt",
    ])
    .where("repo_areas.repository_id", "=", repository.id)
    .orderBy("repo_areas.key", "asc")
    .execute();

  return {
    repositorySlug,
    repositoryDisplayName: repository.display_name,
    activeRuns: runs.items.filter((run) => run.status === "queued" || run.status === "running"),
    recentRuns: runs.items,
    areaStates: areaStates.map((areaState) => ({
      key: areaState.key,
      displayName: areaState.displayName,
      latestStatus:
        areaState.latestStatus as RepositoryHealth["areaStates"][number]["latestStatus"],
      freshnessBucket: determineFreshnessBucket(
        areaState.lastSuccessfulObservedAt ?? areaState.lastObservedAt,
        new Date(),
      ) as RepositoryHealth["areaStates"][number]["freshnessBucket"],
      lastObservedAt: iso(areaState.lastObservedAt),
      lastSuccessfulObservedAt: iso(areaState.lastSuccessfulObservedAt),
    })),
  };
};

export const getCommitDetail = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  commitSha: string,
): Promise<CommitDetail> => {
  const runIds = await db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select(["runs.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("runs.commit_sha", "=", commitSha)
    .orderBy("runs.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    commitSha,
    runs: (await Promise.all(runIds.map((run) => getRunDetail(db, run.id)))).filter(
      (run): run is RunDetail => run !== null,
    ),
  };
};

export const getPullRequestDetail = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  pullRequestNumber: number,
): Promise<PullRequestDetail> => {
  const runIds = await db
    .selectFrom("runs")
    .innerJoin("repositories", "repositories.id", "runs.repository_id")
    .select(["runs.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("runs.pull_request_number", "=", pullRequestNumber)
    .orderBy("runs.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    pullRequestNumber,
    runs: (await Promise.all(runIds.map((run) => getRunDetail(db, run.id)))).filter(
      (run): run is RunDetail => run !== null,
    ),
  };
};

export const resetDatabase = async (db: Kysely<VergeDatabase>): Promise<void> => {
  for (const table of [
    "checkpoints",
    "artifacts",
    "observations",
    "run_events",
    "process_runs",
    "step_runs",
    "runs",
    "event_ingestions",
    "processes",
    "step_specs",
    "repo_area_state",
    "repo_areas",
    "repositories",
  ]) {
    await sql.raw(`truncate table ${table} cascade`).execute(db);
  }
};
