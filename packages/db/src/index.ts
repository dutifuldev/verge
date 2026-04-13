import { randomUUID } from "node:crypto";

import { Kysely, PostgresDialect, sql, type Generated, type Selectable } from "kysely";
import pg from "pg";

import type {
  AppendRunEventInput,
  ClaimedRunProcess,
  CommitDetail,
  PaginatedRunList,
  PullRequestDetail,
  ProcessSpec,
  ProcessSpecSummary,
  RecordArtifactInput,
  RecordCheckpointInput,
  RecordObservationInput,
  RepositoryDefinition,
  RepositoryHealth,
  RunListQuery,
  RunListItem,
  RunRequestDetail,
  RunSummary,
  StepRunDetail,
  StepRunSummary,
  RunTrigger,
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
  created_at: Generated<Date>;
};

type ProcessSpecsTable = {
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
};

type ProcessesTable = {
  id: string;
  process_spec_id: string;
  key: string;
  label: string;
  type: string;
  metadata: Json;
  created_at: Generated<Date>;
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

type RunRequestsTable = {
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
};

type RunsTable = {
  id: string;
  run_request_id: string;
  process_spec_id: string;
  fingerprint: string;
  status: string;
  plan_reason: string;
  reused_from_run_id: string | null;
  checkpoint_source_run_id: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  finished_at: Date | null;
};

type RunProcessesTable = {
  id: string;
  run_id: string;
  process_key: string;
  process_label: string;
  process_type: string;
  status: string;
  selection_payload: Json;
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
  run_id: string;
  run_process_id: string | null;
  kind: string;
  message: string;
  payload: Json;
  created_at: Generated<Date>;
};

type ObservationsTable = {
  id: string;
  run_id: string;
  run_process_id: string | null;
  process_key: string | null;
  area_key: string | null;
  status: string;
  summary: Json;
  execution_scope: Json;
  observed_at: Generated<Date>;
};

type RunArtifactsTable = {
  id: string;
  run_id: string;
  run_process_id: string | null;
  artifact_key: string;
  storage_path: string;
  media_type: string;
  metadata: Json;
  created_at: Generated<Date>;
};

type RunCheckpointsTable = {
  id: string;
  run_id: string;
  process_spec_id: string;
  fingerprint: string;
  completed_process_keys: Json;
  pending_process_keys: Json;
  storage_path: string | null;
  created_at: Generated<Date>;
  resumable_until: Date;
};

type AreaFreshnessStateTable = {
  id: string;
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
  process_specs: ProcessSpecsTable;
  processes: ProcessesTable;
  event_ingestions: EventIngestionsTable;
  run_requests: RunRequestsTable;
  runs: RunsTable;
  run_processes: RunProcessesTable;
  run_events: RunEventsTable;
  observations: ObservationsTable;
  run_artifacts: RunArtifactsTable;
  run_checkpoints: RunCheckpointsTable;
  area_freshness_state: AreaFreshnessStateTable;
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

const applyAreaObservation = async (
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
    .innerJoin("run_requests", "run_requests.repository_id", "repo_areas.repository_id")
    .innerJoin("runs", "runs.run_request_id", "run_requests.id")
    .select(["repo_areas.id as repoAreaId"])
    .where("runs.id", "=", runId)
    .where("repo_areas.key", "=", input.areaKey)
    .executeTakeFirst();

  if (!repoArea) {
    return;
  }

  const observedAt = input.observedAt ?? new Date();
  await db
    .updateTable("area_freshness_state")
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
  processSpecs: ProcessSpec[],
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

  for (const area of repository.areas) {
    const repoArea = await db
      .insertInto("repo_areas")
      .values({
        id: randomUUID(),
        repository_id: repositoryRecord.id,
        key: area.key,
        display_name: area.displayName,
      })
      .onConflict((oc) =>
        oc.columns(["repository_id", "key"]).doUpdateSet({
          display_name: area.displayName,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto("area_freshness_state")
      .values({
        id: randomUUID(),
        repo_area_id: repoArea.id,
        latest_status: "unknown",
        freshness_bucket: "unknown",
        last_observed_at: null,
        last_successful_observed_at: null,
      })
      .onConflict((oc) => oc.column("repo_area_id").doNothing())
      .execute();
  }

  for (const processSpec of processSpecs) {
    const specRecord = await db
      .insertInto("process_specs")
      .values({
        id: randomUUID(),
        repository_id: repositoryRecord.id,
        key: processSpec.key,
        display_name: processSpec.displayName,
        description: processSpec.description,
        kind: processSpec.kind,
        base_command: json(processSpec.baseCommand),
        cwd: processSpec.cwd,
        observed_area_keys: json(processSpec.observedAreaKeys),
        materialization: json(processSpec.materialization),
        reuse_enabled: processSpec.reuseEnabled,
        checkpoint_enabled: processSpec.checkpointEnabled,
        always_run: processSpec.alwaysRun,
      })
      .onConflict((oc) =>
        oc.columns(["repository_id", "key"]).doUpdateSet({
          display_name: processSpec.displayName,
          description: processSpec.description,
          kind: processSpec.kind,
          base_command: json(processSpec.baseCommand),
          cwd: processSpec.cwd,
          observed_area_keys: json(processSpec.observedAreaKeys),
          materialization: json(processSpec.materialization),
          reuse_enabled: processSpec.reuseEnabled,
          checkpoint_enabled: processSpec.checkpointEnabled,
          always_run: processSpec.alwaysRun,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const processDefinition of materializeProcesses(processSpec)) {
      await db
        .insertInto("processes")
        .values({
          id: randomUUID(),
          process_spec_id: specRecord.id,
          key: processDefinition.key,
          label: processDefinition.label,
          type: processDefinition.type,
          metadata: json({
            areaKeys: processDefinition.areaKeys,
            command: processDefinition.command,
          }),
        })
        .onConflict((oc) =>
          oc.columns(["process_spec_id", "key"]).doUpdateSet({
            label: processDefinition.label,
            type: processDefinition.type,
            metadata: json({
              areaKeys: processDefinition.areaKeys,
              command: processDefinition.command,
            }),
          }),
        )
        .execute();
    }
  }

  const processSpecKeys = processSpecs.map((processSpec) => processSpec.key);
  let deleteQuery = db.deleteFrom("process_specs").where("repository_id", "=", repositoryRecord.id);
  if (processSpecKeys.length > 0) {
    deleteQuery = deleteQuery.where("key", "not in", processSpecKeys);
  }
  await deleteQuery.execute();

  return repositoryRecord;
};

export const getRepositoryBySlug = async (
  db: Kysely<VergeDatabase>,
  slug: string,
): Promise<Selectable<RepositoriesTable> | undefined> =>
  db.selectFrom("repositories").selectAll().where("slug", "=", slug).executeTakeFirst();

export const getRepositoryAreas = async (
  db: Kysely<VergeDatabase>,
  repositoryId: string,
): Promise<Array<Selectable<RepoAreasTable>>> =>
  db
    .selectFrom("repo_areas")
    .selectAll()
    .where("repository_id", "=", repositoryId)
    .orderBy("key", "asc")
    .execute();

export const getProcessSpecsForRepository = async (
  db: Kysely<VergeDatabase>,
  repositoryId: string,
): Promise<
  Array<
    Selectable<ProcessSpecsTable> & {
      parsed_process_spec: ProcessSpec;
    }
  >
> => {
  const rows = await db
    .selectFrom("process_specs")
    .selectAll()
    .where("repository_id", "=", repositoryId)
    .orderBy("key", "asc")
    .execute();

  return rows.map((row) => ({
    ...row,
    parsed_process_spec: {
      key: row.key,
      displayName: row.display_name,
      description: row.description,
      kind: row.kind,
      baseCommand: parseJson<string[]>(row.base_command),
      cwd: row.cwd,
      observedAreaKeys: parseJson<string[]>(row.observed_area_keys),
      materialization: parseJson<ProcessSpec["materialization"]>(row.materialization),
      reuseEnabled: row.reuse_enabled,
      checkpointEnabled: row.checkpoint_enabled,
      alwaysRun: row.always_run,
    },
  }));
};

export const getEventIngestionByDelivery = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    source: string;
    deliveryId: string;
  },
): Promise<Selectable<EventIngestionsTable> | undefined> =>
  db
    .selectFrom("event_ingestions")
    .selectAll()
    .where("repository_id", "=", input.repositoryId)
    .where("source", "=", input.source)
    .where("delivery_id", "=", input.deliveryId)
    .executeTakeFirst();

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

  const existing = await getEventIngestionByDelivery(db, {
    repositoryId: input.repositoryId,
    source: input.source,
    deliveryId: input.deliveryId,
  });

  if (!existing) {
    throw new Error("Event ingestion lookup failed");
  }

  return {
    eventIngestion: existing,
    inserted: false,
  };
};

export const deleteEventIngestion = async (
  db: Kysely<VergeDatabase>,
  eventIngestionId: string,
): Promise<void> => {
  await db.deleteFrom("event_ingestions").where("id", "=", eventIngestionId).execute();
};

export const runProcessBelongsToRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    runId: string;
    runProcessId: string;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("run_processes")
    .select("id")
    .where("id", "=", input.runProcessId)
    .where("run_id", "=", input.runId)
    .executeTakeFirst();

  return Boolean(row);
};

export const runProcessLeaseIsActive = async (
  db: Kysely<VergeDatabase>,
  input: {
    runId: string;
    runProcessId: string;
    workerId: string;
    now?: Date;
  },
): Promise<boolean> => {
  const row = await db
    .selectFrom("run_processes")
    .select("id")
    .where("id", "=", input.runProcessId)
    .where("run_id", "=", input.runId)
    .where("claimed_by", "=", input.workerId)
    .where("lease_expires_at", ">", input.now ?? new Date())
    .where("status", "in", ["claimed", "running"])
    .executeTakeFirst();

  return Boolean(row);
};

export const createRunRequest = async (
  db: Kysely<VergeDatabase>,
  input: {
    repositoryId: string;
    eventIngestionId?: string;
    trigger: RunTrigger;
    commitSha: string;
    branch?: string;
    pullRequestNumber?: number;
    changedFiles: string[];
  },
): Promise<Selectable<RunRequestsTable>> =>
  db
    .insertInto("run_requests")
    .values({
      id: randomUUID(),
      repository_id: input.repositoryId,
      event_ingestion_id: input.eventIngestionId ?? null,
      trigger: input.trigger,
      commit_sha: input.commitSha,
      branch: input.branch ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      changed_files: json(input.changedFiles),
      status: "created",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const createRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    runRequestId: string;
    processSpecId: string;
    fingerprint: string;
    status: string;
    planReason: string;
    reusedFromRunId?: string | null;
    checkpointSourceRunId?: string | null;
  },
): Promise<Selectable<RunsTable>> =>
  db
    .insertInto("runs")
    .values({
      id: randomUUID(),
      run_request_id: input.runRequestId,
      process_spec_id: input.processSpecId,
      fingerprint: input.fingerprint,
      status: input.status,
      plan_reason: input.planReason,
      reused_from_run_id: input.reusedFromRunId ?? null,
      checkpoint_source_run_id: input.checkpointSourceRunId ?? null,
      started_at: input.status === "running" ? new Date() : null,
      finished_at:
        input.status === "passed" || input.status === "failed" || input.status === "reused"
          ? new Date()
          : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const createRunProcesses = async (
  db: Kysely<VergeDatabase>,
  input: {
    runId: string;
    processes: Array<{
      processKey: string;
      processLabel: string;
      processType: string;
      selectionPayload: unknown;
      status?: string;
      attemptCount?: number;
    }>;
  },
): Promise<Array<Selectable<RunProcessesTable>>> => {
  if (input.processes.length === 0) {
    return [];
  }

  return db
    .insertInto("run_processes")
    .values(
      input.processes.map((process) => ({
        id: randomUUID(),
        run_id: input.runId,
        process_key: process.processKey,
        process_label: process.processLabel,
        process_type: process.processType,
        status: process.status ?? "queued",
        selection_payload: json(process.selectionPayload),
        attempt_count: process.attemptCount ?? 0,
        created_at: new Date(),
      })),
    )
    .returningAll()
    .execute();
};

export const listRunProcesses = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<Array<Selectable<RunProcessesTable>>> =>
  db
    .selectFrom("run_processes")
    .selectAll()
    .where("run_id", "=", runId)
    .orderBy("created_at", "asc")
    .execute();

export const findReusableRun = async (
  db: Kysely<VergeDatabase>,
  input: {
    processSpecId: string;
    fingerprint: string;
  },
): Promise<Selectable<RunsTable> | undefined> =>
  db
    .selectFrom("runs")
    .selectAll()
    .where("process_spec_id", "=", input.processSpecId)
    .where("fingerprint", "=", input.fingerprint)
    .where((eb) => eb("status", "=", "passed").or("status", "=", "reused"))
    .orderBy("created_at", "desc")
    .executeTakeFirst();

export const findLatestCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    processSpecId: string;
    fingerprint: string;
    now?: Date;
  },
): Promise<Selectable<RunCheckpointsTable> | undefined> =>
  db
    .selectFrom("run_checkpoints")
    .selectAll()
    .where("process_spec_id", "=", input.processSpecId)
    .where("fingerprint", "=", input.fingerprint)
    .where("resumable_until", ">", input.now ?? new Date())
    .orderBy("created_at", "desc")
    .executeTakeFirst();

export const cloneRunForReuse = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceRunId: string;
    newRunId: string;
  },
): Promise<void> => {
  const sourceProcesses = await listRunProcesses(db, input.sourceRunId);
  if (sourceProcesses.length > 0) {
    await createRunProcesses(db, {
      runId: input.newRunId,
      processes: sourceProcesses.map((process) => ({
        processKey: process.process_key,
        processLabel: process.process_label,
        processType: process.process_type,
        selectionPayload: parseJson(process.selection_payload),
        status: "reused",
        attemptCount: process.attempt_count,
      })),
    });
  }

  const sourceObservations = await db
    .selectFrom("observations")
    .selectAll()
    .where("run_id", "=", input.sourceRunId)
    .execute();

  if (sourceObservations.length > 0) {
    const observedAt = new Date();
    await db
      .insertInto("observations")
      .values(
        sourceObservations.map((observation) => ({
          id: randomUUID(),
          run_id: input.newRunId,
          run_process_id: null,
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
        await applyAreaObservation(db, input.newRunId, {
          areaKey: observation.area_key,
          status: observation.status,
          observedAt,
        });
      }
    }
  }
};

export const cloneCompletedProcessesFromCheckpoint = async (
  db: Kysely<VergeDatabase>,
  input: {
    sourceRunId: string;
    newRunId: string;
    completedProcessKeys: string[];
  },
): Promise<void> => {
  if (input.completedProcessKeys.length === 0) {
    return;
  }

  const sourceProcesses = await db
    .selectFrom("run_processes")
    .selectAll()
    .where("run_id", "=", input.sourceRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  await createRunProcesses(db, {
    runId: input.newRunId,
    processes: sourceProcesses.map((process) => ({
      processKey: process.process_key,
      processLabel: process.process_label,
      processType: process.process_type,
      selectionPayload: parseJson(process.selection_payload),
      status: "reused",
      attemptCount: process.attempt_count,
    })),
  });

  const observations = await db
    .selectFrom("observations")
    .selectAll()
    .where("run_id", "=", input.sourceRunId)
    .where("process_key", "in", input.completedProcessKeys)
    .execute();

  if (observations.length > 0) {
    const observedAt = new Date();
    await db
      .insertInto("observations")
      .values(
        observations.map((observation) => ({
          id: randomUUID(),
          run_id: input.newRunId,
          run_process_id: null,
          process_key: observation.process_key,
          area_key: observation.area_key,
          status: observation.status,
          summary: observation.summary,
          execution_scope: observation.execution_scope,
          observed_at: observedAt,
        })),
      )
      .execute();

    for (const observation of observations) {
      if (observation.area_key) {
        await applyAreaObservation(db, input.newRunId, {
          areaKey: observation.area_key,
          status: observation.status,
          observedAt,
        });
      }
    }
  }
};

export const expireLeases = async (db: Kysely<VergeDatabase>, now = new Date()): Promise<void> => {
  await db
    .updateTable("run_processes")
    .set({
      status: "queued",
      claimed_by: null,
      lease_expires_at: null,
    })
    .where("status", "in", ["claimed", "running"])
    .where("lease_expires_at", "<", now)
    .execute();
};

export const claimNextRunProcess = async (
  db: Kysely<VergeDatabase>,
  input: {
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<ClaimedRunProcess | null> =>
  db.transaction().execute(async (trx) => {
    await expireLeases(trx);

    const candidate = await trx
      .selectFrom("run_processes")
      .innerJoin("runs", "runs.id", "run_processes.run_id")
      .innerJoin("run_requests", "run_requests.id", "runs.run_request_id")
      .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
      .innerJoin("process_specs", "process_specs.id", "runs.process_spec_id")
      .select([
        "run_processes.id as runProcessId",
        "run_processes.run_id as runId",
        "run_processes.process_key as processKey",
        "run_processes.process_label as processLabel",
        "run_processes.process_type as processType",
        "run_processes.selection_payload as selectionPayload",
        "run_requests.id as runRequestId",
        "repositories.slug as repositorySlug",
        "repositories.root_path as repositoryRootPath",
        "process_specs.key as processSpecKey",
        "process_specs.display_name as processSpecDisplayName",
        "process_specs.kind as processSpecKind",
        "process_specs.checkpoint_enabled as checkpointEnabled",
        "process_specs.base_command as baseCommand",
      ])
      .where("run_processes.status", "=", "queued")
      .orderBy("run_processes.created_at", "asc")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!candidate) {
      return null;
    }

    const leaseExpiresAt = new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000);
    const claimed = await trx
      .updateTable("run_processes")
      .set({
        status: "claimed",
        claimed_by: input.workerId,
        lease_expires_at: leaseExpiresAt,
        last_heartbeat_at: new Date(),
      })
      .where("id", "=", candidate.runProcessId)
      .where("status", "=", "queued")
      .returning("id")
      .executeTakeFirst();

    if (!claimed) {
      return null;
    }

    return {
      runId: candidate.runId,
      runProcessId: candidate.runProcessId,
      runRequestId: candidate.runRequestId,
      repositorySlug: candidate.repositorySlug,
      repositoryRootPath: candidate.repositoryRootPath,
      processSpecKey: candidate.processSpecKey,
      processSpecDisplayName: candidate.processSpecDisplayName,
      processSpecKind: candidate.processSpecKind,
      processKey: candidate.processKey,
      processLabel: candidate.processLabel,
      areaKeys: parseJson<{ areaKeys?: string[] }>(candidate.selectionPayload).areaKeys ?? [],
      command: [
        ...parseJson<string[]>(candidate.baseCommand),
        ...(parseJson<{ command?: string[] }>(candidate.selectionPayload).command ?? []),
      ],
      checkpointEnabled: candidate.checkpointEnabled,
    };
  });

export const heartbeatRunProcess = async (
  db: Kysely<VergeDatabase>,
  input: {
    runProcessId: string;
    workerId: string;
    leaseSeconds?: number;
  },
): Promise<void> => {
  await db
    .updateTable("run_processes")
    .set({
      last_heartbeat_at: new Date(),
      claimed_by: input.workerId,
      lease_expires_at: new Date(Date.now() + (input.leaseSeconds ?? 30) * 1000),
    })
    .where("id", "=", input.runProcessId)
    .execute();
};

export const recordRunEvent = async (
  db: Kysely<VergeDatabase>,
  runId: string,
  input: AppendRunEventInput,
): Promise<void> => {
  await db
    .insertInto("run_events")
    .values({
      id: randomUUID(),
      run_id: runId,
      run_process_id: input.runProcessId ?? null,
      kind: input.kind,
      message: input.message,
      payload: json(input.payload ?? {}),
    })
    .execute();

  if (input.runProcessId) {
    if (input.kind === "started") {
      await db
        .updateTable("run_processes")
        .set({
          status: "running",
          started_at: new Date(),
          attempt_count: sql`attempt_count + 1`,
        })
        .where("id", "=", input.runProcessId)
        .execute();

      await db
        .updateTable("runs")
        .set({
          status: "running",
          started_at: sql`coalesce(started_at, now())`,
        })
        .where("id", "=", runId)
        .execute();
    }

    if (input.kind === "passed" || input.kind === "failed" || input.kind === "interrupted") {
      await db
        .updateTable("run_processes")
        .set({
          status: input.kind === "passed" ? "passed" : input.kind,
          finished_at: new Date(),
        })
        .where("id", "=", input.runProcessId)
        .execute();

      await refreshRunStatus(db, runId);
    }
  }
};

export const recordObservation = async (
  db: Kysely<VergeDatabase>,
  runId: string,
  input: RecordObservationInput,
): Promise<void> => {
  await db
    .insertInto("observations")
    .values({
      id: randomUUID(),
      run_id: runId,
      run_process_id: input.runProcessId ?? null,
      process_key: input.processKey ?? null,
      area_key: input.areaKey ?? null,
      status: input.status,
      summary: json(input.summary),
      execution_scope: json(input.executionScope),
    })
    .execute();

  if (input.areaKey) {
    await applyAreaObservation(db, runId, {
      areaKey: input.areaKey,
      status: input.status,
    });
  }
};

export const recordArtifact = async (
  db: Kysely<VergeDatabase>,
  runId: string,
  input: RecordArtifactInput,
): Promise<void> => {
  await db
    .insertInto("run_artifacts")
    .values({
      id: randomUUID(),
      run_id: runId,
      run_process_id: input.runProcessId ?? null,
      artifact_key: input.artifactKey,
      storage_path: input.storagePath,
      media_type: input.mediaType,
      metadata: json(input.metadata),
    })
    .execute();
};

export const recordCheckpoint = async (
  db: Kysely<VergeDatabase>,
  runId: string,
  input: {
    processSpecId: string;
    fingerprint: string;
    checkpoint: RecordCheckpointInput;
  },
): Promise<void> => {
  await db
    .insertInto("run_checkpoints")
    .values({
      id: randomUUID(),
      run_id: runId,
      process_spec_id: input.processSpecId,
      fingerprint: input.fingerprint,
      completed_process_keys: json(input.checkpoint.completedProcessKeys),
      pending_process_keys: json(input.checkpoint.pendingProcessKeys),
      storage_path: input.checkpoint.storagePath ?? null,
      resumable_until: new Date(input.checkpoint.resumableUntil),
    })
    .execute();
};

export const refreshRunStatus = async (db: Kysely<VergeDatabase>, runId: string): Promise<void> => {
  const processes = await listRunProcesses(db, runId);
  if (processes.length === 0) {
    return;
  }

  const statuses = processes.map((process) => process.status);
  let status = "queued";
  let finishedAt: Date | null = null;

  if (statuses.some((candidate) => candidate === "failed")) {
    status = "failed";
    finishedAt = new Date();
  } else if (statuses.some((candidate) => candidate === "interrupted")) {
    status = "interrupted";
    finishedAt = new Date();
  } else if (statuses.some((candidate) => candidate === "running" || candidate === "claimed")) {
    status = "running";
  } else if (statuses.every((candidate) => candidate === "reused")) {
    status = "reused";
    finishedAt = new Date();
  } else if (statuses.every((candidate) => ["passed", "reused", "skipped"].includes(candidate))) {
    status = "passed";
    finishedAt = new Date();
  }

  await db
    .updateTable("runs")
    .set({
      status,
      finished_at: finishedAt,
    })
    .where("id", "=", runId)
    .execute();

  const request = await db
    .selectFrom("runs")
    .select("run_request_id")
    .where("id", "=", runId)
    .executeTakeFirst();

  if (request) {
    const runs = await db
      .selectFrom("runs")
      .select(["status"])
      .where("run_request_id", "=", request.run_request_id)
      .execute();

    const requestStatus = runs.some(
      (row) => row.status === "failed" || row.status === "interrupted",
    )
      ? "failed"
      : runs.every((row) => ["passed", "reused"].includes(row.status))
        ? "completed"
        : runs.some((row) => row.status === "running")
          ? "running"
          : runs.some((row) => row.status === "queued" || row.status === "claimed")
            ? "queued"
            : "created";

    await db
      .updateTable("run_requests")
      .set({ status: requestStatus })
      .where("id", "=", request.run_request_id)
      .execute();
  }
};

const selectRunRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("runs")
    .innerJoin("run_requests", "run_requests.id", "runs.run_request_id")
    .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
    .innerJoin("process_specs", "process_specs.id", "runs.process_spec_id")
    .select([
      "runs.id as runId",
      "runs.run_request_id as runRequestId",
      "runs.status as runStatus",
      "runs.plan_reason as planReason",
      "runs.reused_from_run_id as reusedFromRunId",
      "runs.checkpoint_source_run_id as checkpointSourceRunId",
      "runs.created_at as runCreatedAt",
      "runs.started_at as runStartedAt",
      "runs.finished_at as runFinishedAt",
      "process_specs.key as processSpecKey",
      "process_specs.display_name as processSpecDisplayName",
      "repositories.slug as repositorySlug",
      "run_requests.trigger as trigger",
      "run_requests.commit_sha as commitSha",
      "run_requests.branch as branch",
      "run_requests.pull_request_number as pullRequestNumber",
      "run_requests.changed_files as changedFiles",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const selectRunRequestRows = (db: Kysely<VergeDatabase>, repositorySlug?: string) => {
  let query = db
    .selectFrom("run_requests")
    .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
    .select([
      "run_requests.id as runRequestId",
      "repositories.slug as repositorySlug",
      "run_requests.trigger as trigger",
      "run_requests.commit_sha as commitSha",
      "run_requests.branch as branch",
      "run_requests.pull_request_number as pullRequestNumber",
      "run_requests.changed_files as changedFiles",
      "run_requests.created_at as createdAt",
    ]);

  if (repositorySlug) {
    query = query.where("repositories.slug", "=", repositorySlug);
  }

  return query;
};

const summarizeRunStatus = (steps: Array<Pick<StepRunSummary, "status">>): RunSummary["status"] => {
  if (steps.length === 0) {
    return "queued";
  }

  const statuses = steps.map((step) => step.status);

  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (statuses.some((status) => status === "interrupted")) {
    return "interrupted";
  }

  if (statuses.some((status) => status === "running")) {
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

const summarizeRunTiming = (
  steps: Array<Pick<StepRunSummary, "startedAt" | "finishedAt">>,
): Pick<RunSummary, "startedAt" | "finishedAt"> => {
  const startedCandidates = steps
    .map((step) => step.startedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());

  const finishedCandidates = steps
    .map((step) => step.finishedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime());

  return {
    startedAt: startedCandidates.length
      ? new Date(Math.min(...startedCandidates)).toISOString()
      : null,
    finishedAt:
      finishedCandidates.length === steps.length && finishedCandidates.length > 0
        ? new Date(Math.max(...finishedCandidates)).toISOString()
        : null,
  };
};

const toStepRunSummary = async (
  db: Kysely<VergeDatabase>,
  row: Awaited<ReturnType<ReturnType<typeof selectRunRows>["executeTakeFirst"]>>,
): Promise<StepRunSummary> => {
  if (!row) {
    throw new Error("Missing run row");
  }

  const processes = await listRunProcesses(db, row.runId);

  return {
    id: row.runId,
    runRequestId: row.runRequestId,
    processSpecKey: row.processSpecKey,
    processSpecDisplayName: row.processSpecDisplayName,
    status: row.runStatus as RunSummary["status"],
    planReason: row.planReason,
    reusedFromRunId: row.reusedFromRunId,
    checkpointSourceRunId: row.checkpointSourceRunId,
    createdAt: row.runCreatedAt.toISOString(),
    startedAt: iso(row.runStartedAt),
    finishedAt: iso(row.runFinishedAt),
    processCount: processes.length,
  };
};

const toStepRunDetail = async (
  db: Kysely<VergeDatabase>,
  row: Awaited<ReturnType<ReturnType<typeof selectRunRows>["executeTakeFirst"]>>,
): Promise<StepRunDetail> => {
  if (!row) {
    throw new Error("Missing run row");
  }

  const summary = await toStepRunSummary(db, row);
  const observations = await db
    .selectFrom("observations")
    .selectAll()
    .where("run_id", "=", row.runId)
    .orderBy("observed_at", "asc")
    .execute();
  const events = await db
    .selectFrom("run_events")
    .selectAll()
    .where("run_id", "=", row.runId)
    .orderBy("created_at", "asc")
    .execute();
  const artifacts = await db
    .selectFrom("run_artifacts")
    .selectAll()
    .where("run_id", "=", row.runId)
    .orderBy("created_at", "asc")
    .execute();
  const checkpoints = await db
    .selectFrom("run_checkpoints")
    .selectAll()
    .where("run_id", "=", row.runId)
    .orderBy("created_at", "asc")
    .execute();

  return {
    ...summary,
    processes: await listRunProcesses(db, row.runId).then((processes) =>
      processes.map((process) => ({
        id: process.id,
        processKey: process.process_key,
        processLabel: process.process_label,
        processType: process.process_type,
        status: process.status as StepRunDetail["processes"][number]["status"],
        attemptCount: process.attempt_count,
        startedAt: iso(process.started_at),
        finishedAt: iso(process.finished_at),
      })),
    ),
    observations: observations.map((observation) => ({
      id: observation.id,
      runId: observation.run_id,
      runProcessId: observation.run_process_id,
      processKey: observation.process_key,
      areaKey: observation.area_key,
      status: observation.status as StepRunDetail["observations"][number]["status"],
      summary: parseJson<Record<string, unknown>>(observation.summary),
      executionScope: parseJson<Record<string, unknown>>(observation.execution_scope),
      observedAt: observation.observed_at.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id,
      runId: event.run_id,
      runProcessId: event.run_process_id,
      kind: event.kind,
      message: event.message,
      payload: parseJson<Record<string, unknown>>(event.payload),
      createdAt: event.created_at.toISOString(),
    })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      runId: artifact.run_id,
      runProcessId: artifact.run_process_id,
      artifactKey: artifact.artifact_key,
      storagePath: artifact.storage_path,
      mediaType: artifact.media_type,
      metadata: parseJson<Record<string, unknown>>(artifact.metadata),
      createdAt: artifact.created_at.toISOString(),
    })),
    checkpoints: checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      runId: checkpoint.run_id,
      completedProcessKeys: parseJson<string[]>(checkpoint.completed_process_keys),
      pendingProcessKeys: parseJson<string[]>(checkpoint.pending_process_keys),
      storagePath: checkpoint.storage_path,
      createdAt: checkpoint.created_at.toISOString(),
      resumableUntil: checkpoint.resumable_until.toISOString(),
    })),
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
  const rows = await selectRunRequestRows(db, repositorySlug)
    .orderBy("run_requests.created_at", "desc")
    .execute();

  const summaries = await Promise.all(
    rows.map(async (row): Promise<RunListItem> => {
      const stepRows = await selectRunRows(db)
        .where("runs.run_request_id", "=", row.runRequestId)
        .orderBy("runs.created_at", "asc")
        .execute();
      const steps = await Promise.all(stepRows.map((stepRow) => toStepRunSummary(db, stepRow)));
      const timing = summarizeRunTiming(steps);

      return {
        id: row.runRequestId,
        repositorySlug: row.repositorySlug,
        trigger: row.trigger as RunTrigger,
        commitSha: row.commitSha,
        branch: row.branch,
        pullRequestNumber: row.pullRequestNumber,
        changedFiles: parseJson<string[]>(row.changedFiles),
        status: summarizeRunStatus(steps),
        createdAt: row.createdAt.toISOString(),
        startedAt: timing.startedAt,
        finishedAt: timing.finishedAt,
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

    if (query.stepKey && !summary.steps.some((step) => step.processSpecKey === query.stepKey)) {
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

export const getRunRequestDetail = async (
  db: Kysely<VergeDatabase>,
  runRequestId: string,
): Promise<RunRequestDetail> => {
  const request = await db
    .selectFrom("run_requests")
    .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
    .select([
      "run_requests.id as id",
      "repositories.slug as repositorySlug",
      "run_requests.trigger as trigger",
      "run_requests.commit_sha as commitSha",
      "run_requests.branch as branch",
      "run_requests.pull_request_number as pullRequestNumber",
      "run_requests.changed_files as changedFiles",
      "run_requests.created_at as createdAt",
    ])
    .where("run_requests.id", "=", runRequestId)
    .executeTakeFirstOrThrow();

  const stepRows = await selectRunRows(db)
    .where("runs.run_request_id", "=", runRequestId)
    .orderBy("runs.created_at", "asc")
    .execute();
  const steps = await Promise.all(stepRows.map((run) => toStepRunSummary(db, run)));
  const timing = summarizeRunTiming(steps);

  return {
    id: request.id,
    repositorySlug: request.repositorySlug,
    trigger: request.trigger as RunRequestDetail["trigger"],
    commitSha: request.commitSha,
    branch: request.branch,
    pullRequestNumber: request.pullRequestNumber,
    changedFiles: parseJson<string[]>(request.changedFiles),
    status: summarizeRunStatus(steps),
    createdAt: request.createdAt.toISOString(),
    startedAt: timing.startedAt,
    finishedAt: timing.finishedAt,
    steps,
  };
};

export const getRunDetail = async (
  db: Kysely<VergeDatabase>,
  runId: string,
): Promise<StepRunDetail> => {
  const runRow = await selectRunRows(db).where("runs.id", "=", runId).executeTakeFirstOrThrow();
  return toStepRunDetail(db, runRow);
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
  const allRuns = await listRepositoryRuns(db, repositorySlug, {
    page: 1,
    pageSize: 12,
  });
  const summaries = allRuns.items;
  const areaStates = await db
    .selectFrom("area_freshness_state")
    .innerJoin("repo_areas", "repo_areas.id", "area_freshness_state.repo_area_id")
    .select([
      "repo_areas.key as key",
      "repo_areas.display_name as displayName",
      "area_freshness_state.latest_status as latestStatus",
      "area_freshness_state.freshness_bucket as freshnessBucket",
      "area_freshness_state.last_observed_at as lastObservedAt",
      "area_freshness_state.last_successful_observed_at as lastSuccessfulObservedAt",
    ])
    .where("repo_areas.repository_id", "=", repository.id)
    .orderBy("repo_areas.key", "asc")
    .execute();

  return {
    repositorySlug,
    repositoryDisplayName: repository.display_name,
    activeRuns: summaries.filter((run) => run.status === "queued" || run.status === "running"),
    recentRuns: summaries,
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
  const requests = await db
    .selectFrom("run_requests")
    .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
    .select(["run_requests.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("run_requests.commit_sha", "=", commitSha)
    .orderBy("run_requests.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    commitSha,
    runRequests: await Promise.all(requests.map((request) => getRunRequestDetail(db, request.id))),
  };
};

export const getPullRequestDetail = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
  pullRequestNumber: number,
): Promise<PullRequestDetail> => {
  const requests = await db
    .selectFrom("run_requests")
    .innerJoin("repositories", "repositories.id", "run_requests.repository_id")
    .select(["run_requests.id"])
    .where("repositories.slug", "=", repositorySlug)
    .where("run_requests.pull_request_number", "=", pullRequestNumber)
    .orderBy("run_requests.created_at", "desc")
    .execute();

  return {
    repositorySlug,
    pullRequestNumber,
    runRequests: await Promise.all(requests.map((request) => getRunRequestDetail(db, request.id))),
  };
};

export const listProcessSpecSummaries = async (
  db: Kysely<VergeDatabase>,
  repositorySlug: string,
): Promise<ProcessSpecSummary[]> => {
  const specs = await db
    .selectFrom("process_specs")
    .innerJoin("repositories", "repositories.id", "process_specs.repository_id")
    .select([
      "process_specs.id",
      "repositories.slug as repositorySlug",
      "process_specs.key",
      "process_specs.display_name as displayName",
      "process_specs.description",
      "process_specs.kind",
      "process_specs.base_command as baseCommand",
      "process_specs.cwd",
      "process_specs.observed_area_keys as observedAreaKeys",
      "process_specs.materialization",
      "process_specs.reuse_enabled as reuseEnabled",
      "process_specs.checkpoint_enabled as checkpointEnabled",
      "process_specs.always_run as alwaysRun",
    ])
    .where("repositories.slug", "=", repositorySlug)
    .orderBy("process_specs.key", "asc")
    .execute();

  return specs.map((spec) => ({
    id: spec.id,
    repositorySlug: spec.repositorySlug,
    key: spec.key,
    displayName: spec.displayName,
    description: spec.description,
    kind: spec.kind,
    baseCommand: parseJson<string[]>(spec.baseCommand),
    cwd: spec.cwd,
    observedAreaKeys: parseJson<string[]>(spec.observedAreaKeys),
    materialization: parseJson(spec.materialization),
    reuseEnabled: spec.reuseEnabled,
    checkpointEnabled: spec.checkpointEnabled,
    alwaysRun: spec.alwaysRun,
  }));
};

export const resetDatabase = async (db: Kysely<VergeDatabase>): Promise<void> => {
  for (const table of [
    "run_checkpoints",
    "run_artifacts",
    "observations",
    "run_events",
    "run_processes",
    "runs",
    "run_requests",
    "event_ingestions",
    "processes",
    "process_specs",
    "area_freshness_state",
    "repo_areas",
    "repositories",
  ]) {
    await sql.raw(`truncate table ${table} cascade`).execute(db);
  }
};
