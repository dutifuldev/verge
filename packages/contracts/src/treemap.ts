import { z } from "zod";

export const treemapNodeKindSchema = z.enum(["run", "commit", "step", "file", "process"]);

export const treemapNodeStatusSchema = z.enum([
  "planned",
  "queued",
  "running",
  "passed",
  "failed",
  "reused",
  "interrupted",
  "skipped",
]);

export const treemapNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    kind: treemapNodeKindSchema,
    label: z.string().min(1),
    valueMs: z.number().int().nonnegative(),
    wallDurationMs: z.number().int().nonnegative().nullable(),
    status: treemapNodeStatusSchema,
    filePath: z.string().nullable(),
    stepKey: z.string().nullable(),
    processKey: z.string().nullable(),
    sourceRunId: z.string().uuid().nullable(),
    sourceStepRunId: z.string().uuid().nullable(),
    sourceProcessRunId: z.string().uuid().nullable(),
    reused: z.boolean(),
    attemptCount: z.number().int().nonnegative().nullable(),
    children: z.array(treemapNodeSchema).optional(),
  }),
);

export const runTreemapSchema = z.object({
  runId: z.string().uuid(),
  repositorySlug: z.string(),
  tree: treemapNodeSchema,
});

export const commitTreemapSchema = z.object({
  repositorySlug: z.string(),
  commitSha: z.string(),
  tree: treemapNodeSchema,
});

export type TreemapNode = z.infer<typeof treemapNodeSchema>;
export type RunTreemap = z.infer<typeof runTreemapSchema>;
export type CommitTreemap = z.infer<typeof commitTreemapSchema>;
