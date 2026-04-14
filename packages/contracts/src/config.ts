import { z } from "zod";

export const processMaterializationKindSchema = z.enum([
  "singleProcess",
  "namedProcesses",
  "discoveredProcesses",
  "fixedShards",
]);

export const processDefinitionSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  areaKeys: z.array(z.string()).default([]),
  extraArgs: z.array(z.string()).default([]),
  filePath: z.string().optional(),
  kind: z.string().default("named"),
});

export const processMaterializationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("singleProcess"),
    process: processDefinitionSchema,
  }),
  z.object({
    kind: z.literal("namedProcesses"),
    processes: z.array(processDefinitionSchema).min(1),
  }),
  z.object({
    kind: z.literal("discoveredProcesses"),
    discoveryCommand: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("fixedShards"),
    count: z.number().int().positive(),
    displayNamePrefix: z.string().min(1),
    areaKeys: z.array(z.string()).default([]),
    extraArgsTemplate: z.array(z.string()).default([]),
  }),
]);

export const stepSpecSchema = z.object({
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  kind: z.string().min(1),
  baseCommand: z.array(z.string()).min(1),
  cwd: z.string().default("."),
  observedAreaKeys: z.array(z.string()).default([]),
  materialization: processMaterializationSchema,
  reuseEnabled: z.boolean().default(false),
  checkpointEnabled: z.boolean().default(false),
  alwaysRun: z.boolean().default(false),
});

export const repositoryDefinitionSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  rootPath: z.string().min(1),
  defaultBranch: z.string().min(1),
  areas: z.array(
    z.object({
      key: z.string().min(1),
      displayName: z.string().min(1),
      pathPrefixes: z.array(z.string()).default([]),
    }),
  ),
});

export const repositorySummarySchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  defaultBranch: z.string(),
});

export const vergeConfigSchema = z.object({
  repository: repositoryDefinitionSchema,
  steps: z.array(stepSpecSchema).min(1),
});

export const stepSpecSummarySchema = stepSpecSchema.extend({
  id: z.string().uuid(),
  repositorySlug: z.string(),
});

export type StepSpec = z.infer<typeof stepSpecSchema>;
export type RepositoryDefinition = z.infer<typeof repositoryDefinitionSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type VergeConfig = z.infer<typeof vergeConfigSchema>;
export type ProcessDefinition = z.infer<typeof processDefinitionSchema>;
export type StepSpecSummary = z.infer<typeof stepSpecSummarySchema>;
