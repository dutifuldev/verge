import { z } from "zod";

export const runStatusSchema = z.enum([
  "planned",
  "queued",
  "running",
  "passed",
  "failed",
  "reused",
  "interrupted",
]);

export const stepRunStatusSchema = runStatusSchema;

export const processRunStatusSchema = z.enum([
  "queued",
  "claimed",
  "running",
  "passed",
  "failed",
  "interrupted",
  "reused",
  "skipped",
]);

export const observationStatusSchema = z.enum(["passed", "failed", "unknown", "reused"]);

export const freshnessBucketSchema = z.enum(["fresh", "stale", "unknown"]);

export const runTriggerSchema = z.enum(["manual", "push", "pull_request"]);

export type RunStatus = z.infer<typeof runStatusSchema>;
export type StepRunStatus = z.infer<typeof stepRunStatusSchema>;
export type ProcessRunStatus = z.infer<typeof processRunStatusSchema>;
export type ObservationStatus = z.infer<typeof observationStatusSchema>;
export type FreshnessBucket = z.infer<typeof freshnessBucketSchema>;
export type RunTrigger = z.infer<typeof runTriggerSchema>;
