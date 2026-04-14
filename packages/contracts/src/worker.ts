import { z } from "zod";

import { observationStatusSchema, runTriggerSchema } from "./status.js";

export const createManualRunInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedStepKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
});

export const createRunInputSchema = z.object({
  repositorySlug: z.string().default("verge"),
  trigger: runTriggerSchema,
  commitSha: z.string().min(1),
  branch: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
  requestedStepKeys: z.array(z.string()).optional(),
  resumeFromCheckpoint: z.boolean().default(false),
  disableReuse: z.boolean().default(false),
  pullRequestNumber: z.number().int().positive().optional(),
  eventIngestionId: z.string().uuid().optional(),
});

export const createManualRunResponseSchema = z.object({
  runId: z.string().uuid(),
  stepRunIds: z.array(z.string().uuid()),
});

export const workerClaimRequestSchema = z.object({
  workerId: z.string().min(1),
});

export const claimedProcessRunSchema = z.object({
  runId: z.string().uuid(),
  stepRunId: z.string().uuid(),
  processRunId: z.string().uuid(),
  repositorySlug: z.string(),
  repositoryRootPath: z.string(),
  stepKey: z.string(),
  stepDisplayName: z.string(),
  stepKind: z.string(),
  processKey: z.string(),
  processDisplayName: z.string(),
  processKind: z.string(),
  areaKeys: z.array(z.string()),
  command: z.array(z.string()),
  checkpointEnabled: z.boolean(),
});

export const workerClaimResponseSchema = z.object({
  assignment: claimedProcessRunSchema.nullable(),
});

export const workerHeartbeatInputSchema = z.object({
  workerId: z.string().min(1),
  processRunId: z.string().uuid(),
});

export const appendRunEventInputSchema = z.object({
  workerId: z.string().optional(),
  processRunId: z.string().uuid().optional(),
  kind: z.enum(["claimed", "started", "passed", "failed", "interrupted", "info"]),
  message: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const recordObservationInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid().optional(),
  processKey: z.string().optional(),
  areaKey: z.string().nullable().optional(),
  status: observationStatusSchema,
  summary: z.record(z.string(), z.unknown()).default({}),
  executionScope: z.record(z.string(), z.unknown()).default({}),
});

export const recordArtifactInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid().optional(),
  artifactKey: z.string().min(1),
  storagePath: z.string().min(1),
  mediaType: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const recordCheckpointInputSchema = z.object({
  workerId: z.string().min(1).optional(),
  processRunId: z.string().uuid(),
  completedProcessKeys: z.array(z.string()).default([]),
  pendingProcessKeys: z.array(z.string()).default([]),
  storagePath: z.string().optional(),
  resumableUntil: z.string().datetime(),
});

export type CreateManualRunInput = z.infer<typeof createManualRunInputSchema>;
export type CreateRunInput = z.infer<typeof createRunInputSchema>;
export type WorkerClaimRequest = z.infer<typeof workerClaimRequestSchema>;
export type ClaimedProcessRun = z.infer<typeof claimedProcessRunSchema>;
export type AppendRunEventInput = z.infer<typeof appendRunEventInputSchema>;
export type RecordObservationInput = z.infer<typeof recordObservationInputSchema>;
export type RecordArtifactInput = z.infer<typeof recordArtifactInputSchema>;
export type RecordCheckpointInput = z.infer<typeof recordCheckpointInputSchema>;
