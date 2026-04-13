import type { FastifyInstance } from "fastify";

import {
  appendRunEventInputSchema,
  recordArtifactInputSchema,
  recordCheckpointInputSchema,
  recordObservationInputSchema,
  workerClaimRequestSchema,
  workerHeartbeatInputSchema,
} from "@verge/contracts";
import {
  claimNextProcessRun,
  heartbeatProcessRun,
  processRunBelongsToStepRun,
  processRunLeaseIsActive,
  recordArtifact,
  recordCheckpoint,
  recordObservation,
  recordRunEvent,
  refreshStepRunStatus,
} from "@verge/db";

import type { ApiContext } from "../context.js";

export const registerWorkerRoutes = (app: FastifyInstance, context: ApiContext): void => {
  const ensureProcessRunMutationAccess = async (
    stepRunId: string,
    processRunId: string | undefined,
    workerId: string | undefined,
  ): Promise<boolean> => {
    if (!processRunId) {
      return true;
    }

    if (
      !(await processRunBelongsToStepRun(context.connection.db, {
        stepRunId,
        processRunId,
      }))
    ) {
      return false;
    }

    if (!workerId) {
      return false;
    }

    return processRunLeaseIsActive(context.connection.db, {
      stepRunId,
      processRunId,
      workerId,
    });
  };

  app.post("/workers/claim", async (request) => {
    const input = workerClaimRequestSchema.parse(request.body);
    return {
      assignment: await claimNextProcessRun(context.connection.db, {
        workerId: input.workerId,
      }),
    };
  });

  app.post("/workers/steps/:stepRunId/heartbeat", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = workerHeartbeatInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }

    await heartbeatProcessRun(context.connection.db, {
      processRunId: input.processRunId,
      workerId: input.workerId,
    });

    return { stepRunId: params.stepRunId, ok: true };
  });

  app.post("/workers/steps/:stepRunId/events", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = appendRunEventInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordRunEvent(context.connection.db, params.stepRunId, input);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/observations", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordObservationInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordObservation(context.connection.db, params.stepRunId, input);
    await refreshStepRunStatus(context.connection.db, params.stepRunId);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/artifacts", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordArtifactInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }
    await recordArtifact(context.connection.db, params.stepRunId, input);
    return { ok: true };
  });

  app.post("/workers/steps/:stepRunId/checkpoints", async (request, reply) => {
    const params = request.params as { stepRunId: string };
    const input = recordCheckpointInputSchema.parse(request.body);
    if (
      !(await ensureProcessRunMutationAccess(params.stepRunId, input.processRunId, input.workerId))
    ) {
      return reply
        .code(409)
        .send({ ok: false, message: "Process run does not belong to the step run" });
    }

    const stepRun = await context.connection.db
      .selectFrom("step_runs")
      .select(["step_spec_id", "step_key", "fingerprint"])
      .where("id", "=", params.stepRunId)
      .executeTakeFirstOrThrow();

    await recordCheckpoint(context.connection.db, params.stepRunId, {
      stepSpecId: stepRun.step_spec_id,
      stepKey: stepRun.step_key,
      fingerprint: stepRun.fingerprint,
      checkpoint: input,
    });
    return { ok: true };
  });
};
