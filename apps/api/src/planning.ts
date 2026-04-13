import { randomUUID } from "node:crypto";

import { computeStepConfigFingerprint, planStepRuns } from "@verge/core";
import type { RepositoryDefinition } from "@verge/contracts";
import {
  cloneCompletedProcessesFromCheckpoint,
  cloneStepRunForReuse,
  createProcessRuns,
  createRun,
  createStepRun,
  findLatestCheckpoint,
  findReusableStepRun,
  getStepSpecsForRepository,
  refreshRunStatus,
  refreshStepRunStatus,
  type DatabaseExecutor,
} from "@verge/db";

import { parseStringArray } from "./utils.js";

const interruptPendingProcessesForStepRun = async (
  db: DatabaseExecutor,
  stepRunId: string,
): Promise<void> => {
  const interruptedAt = new Date();
  const updated = await db
    .updateTable("process_runs")
    .set({
      status: "interrupted",
      finished_at: interruptedAt,
      claimed_by: null,
      lease_expires_at: null,
      last_heartbeat_at: null,
    })
    .where("step_run_id", "=", stepRunId)
    .where("status", "in", ["queued", "claimed", "running"])
    .executeTakeFirst();

  if (Number(updated.numUpdatedRows) > 0) {
    await db
      .insertInto("run_events")
      .values({
        id: randomUUID(),
        step_run_id: stepRunId,
        process_run_id: null,
        kind: "interrupted",
        message: "Pending processes were transferred to a resumed step",
        payload: JSON.stringify({ reason: "checkpoint-resume-transfer" }),
      })
      .execute();
    await refreshStepRunStatus(db, stepRunId);
  }
};

export const createPlannedRun = async (
  db: DatabaseExecutor,
  repository: {
    id: string;
    slug: string;
    root_path: string;
  },
  repositoryDefinition: Pick<RepositoryDefinition, "slug" | "areas">,
  input: {
    trigger: "manual" | "push" | "pull_request";
    commitSha: string;
    branch?: string;
    changedFiles?: string[];
    requestedStepKeys?: string[];
    resumeFromCheckpoint?: boolean;
    disableReuse?: boolean;
    pullRequestNumber?: number;
    eventIngestionId?: string;
  },
): Promise<{
  runId: string;
  stepRunIds: string[];
}> => {
  const stepSpecs = await getStepSpecsForRepository(db, repository.id);

  const run = await createRun(db, {
    repositoryId: repository.id,
    trigger: input.trigger,
    commitSha: input.commitSha,
    changedFiles: input.changedFiles ?? [],
    ...(input.eventIngestionId ? { eventIngestionId: input.eventIngestionId } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(input.pullRequestNumber ? { pullRequestNumber: input.pullRequestNumber } : {}),
  });

  const plans = await planStepRuns({
    repositorySlug: repository.slug,
    stepSpecs: stepSpecs.map((spec) => spec.parsed_step_spec),
    changedFiles: input.changedFiles ?? [],
    repository: repositoryDefinition,
    commitSha: input.commitSha,
    ...(input.requestedStepKeys ? { requestedStepKeys: input.requestedStepKeys } : {}),
  });

  const createdStepRunIds: string[] = [];

  for (const plan of plans) {
    const stepSpecRow = stepSpecs.find((spec) => spec.key === plan.stepSpec.key);
    if (!stepSpecRow) {
      continue;
    }

    const processCatalog = await db
      .selectFrom("processes")
      .select(["id", "key"])
      .where("step_spec_id", "=", stepSpecRow.id)
      .execute();
    const processIds = new Map(processCatalog.map((process) => [process.key, process.id]));
    const configFingerprint = computeStepConfigFingerprint(plan.stepSpec);

    if (input.resumeFromCheckpoint && plan.stepSpec.checkpointEnabled) {
      const checkpoint = await findLatestCheckpoint(db, {
        repositoryId: repository.id,
        stepKey: plan.stepSpec.key,
        stepSpecId: stepSpecRow.id,
        fingerprint: plan.fingerprint,
      });

      if (checkpoint) {
        const completedProcessKeys = new Set(parseStringArray(checkpoint.completed_process_keys));
        const pendingProcesses = plan.processes.filter(
          (process) => !completedProcessKeys.has(process.key),
        );

        const resumedStepRun = await createStepRun(db, {
          runId: run.id,
          stepSpecId: stepSpecRow.id,
          stepSpec: plan.stepSpec,
          configFingerprint,
          fingerprint: plan.fingerprint,
          status: pendingProcesses.length === 0 ? "reused" : "queued",
          planReason: `resumed from checkpoint ${checkpoint.id}`,
          checkpointSourceStepRunId: checkpoint.step_run_id,
        });

        await cloneCompletedProcessesFromCheckpoint(db, {
          sourceStepRunId: checkpoint.step_run_id,
          newStepRunId: resumedStepRun.id,
          completedProcessKeys: [...completedProcessKeys],
        });
        await interruptPendingProcessesForStepRun(db, checkpoint.step_run_id);

        await createProcessRuns(db, {
          stepRunId: resumedStepRun.id,
          processes: pendingProcesses.map((process) => ({
            processId: processIds.get(process.key) ?? null,
            processKey: process.key,
            displayName: process.displayName,
            kind: process.kind,
            filePath: process.filePath ?? null,
            metadata: {
              areaKeys: process.areaKeys,
              filePath: process.filePath ?? null,
            },
            selectionPayload: {
              areaKeys: process.areaKeys,
              command: process.command.slice(plan.stepSpec.baseCommand.length),
            },
          })),
        });

        await refreshStepRunStatus(db, resumedStepRun.id);
        createdStepRunIds.push(resumedStepRun.id);
        continue;
      }
    }

    if (!input.disableReuse && plan.stepSpec.reuseEnabled) {
      const reusableStepRun = await findReusableStepRun(db, {
        repositoryId: repository.id,
        stepKey: plan.stepSpec.key,
        stepSpecId: stepSpecRow.id,
        fingerprint: plan.fingerprint,
      });

      if (reusableStepRun) {
        const reusedStepRun = await createStepRun(db, {
          runId: run.id,
          stepSpecId: stepSpecRow.id,
          stepSpec: plan.stepSpec,
          configFingerprint,
          fingerprint: plan.fingerprint,
          status: "reused",
          planReason: `reused prior successful step run ${reusableStepRun.id}`,
          reusedFromStepRunId: reusableStepRun.id,
        });
        await cloneStepRunForReuse(db, {
          sourceStepRunId: reusableStepRun.id,
          newStepRunId: reusedStepRun.id,
        });
        await refreshStepRunStatus(db, reusedStepRun.id);
        createdStepRunIds.push(reusedStepRun.id);
        continue;
      }
    }

    const stepRun = await createStepRun(db, {
      runId: run.id,
      stepSpecId: stepSpecRow.id,
      stepSpec: plan.stepSpec,
      configFingerprint,
      fingerprint: plan.fingerprint,
      status: "queued",
      planReason: plan.planReason,
    });

    await createProcessRuns(db, {
      stepRunId: stepRun.id,
      processes: plan.processes.map((process) => ({
        processId: processIds.get(process.key) ?? null,
        processKey: process.key,
        displayName: process.displayName,
        kind: process.kind,
        filePath: process.filePath ?? null,
        metadata: {
          areaKeys: process.areaKeys,
          filePath: process.filePath ?? null,
        },
        selectionPayload: {
          areaKeys: process.areaKeys,
          command: process.command.slice(plan.stepSpec.baseCommand.length),
        },
      })),
    });

    await refreshStepRunStatus(db, stepRun.id);
    createdStepRunIds.push(stepRun.id);
  }

  await refreshRunStatus(db, run.id);

  return {
    runId: run.id,
    stepRunIds: createdStepRunIds,
  };
};
