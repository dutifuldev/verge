import { z } from "zod";

export const githubWebhookPushPayloadSchema = z.object({
  ref: z.string().min(1),
  after: z.string().min(1),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  head_commit: z
    .object({
      message: z.string().min(1),
    })
    .nullable()
    .optional(),
  commits: z
    .array(
      z.object({
        added: z.array(z.string()).default([]),
        modified: z.array(z.string()).default([]),
        removed: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export const githubWebhookPullRequestPayloadSchema = z.object({
  action: z.string().min(1),
  number: z.number().int().positive(),
  repository: z.object({
    full_name: z.string().min(1),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({
      sha: z.string().min(1),
      ref: z.string().min(1),
    }),
    base: z.object({
      ref: z.string().min(1),
    }),
    changed_files: z.number().int().nonnegative().optional(),
  }),
});
