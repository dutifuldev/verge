import { randomUUID } from "node:crypto";

import { type Kysely } from "kysely";

import type { RepositoryDefinition, StepSpec, StepSpecSummary } from "@verge/contracts";
import { materializeProcesses } from "@verge/core";

import {
  json,
  parseJson,
  type RepositoryRow,
  type StepSpecRow,
  type VergeDatabase,
} from "./shared.js";

export const syncRepositoryConfiguration = async (
  db: Kysely<VergeDatabase>,
  repository: RepositoryDefinition,
  stepSpecs: StepSpec[],
): Promise<RepositoryRow> => {
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
): Promise<RepositoryRow | undefined> =>
  db.selectFrom("repositories").selectAll().where("slug", "=", slug).executeTakeFirst();

export const getStepSpecsForRepository = async (
  db: Kysely<VergeDatabase>,
  repositoryId: string,
): Promise<
  Array<
    StepSpecRow & {
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
