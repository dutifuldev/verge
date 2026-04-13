import type { StepSpec } from "@verge/contracts";

import {
  computeExecutionFingerprint,
  deriveAreaKeysFromChangedFiles,
  isProcessSpecRelevant,
  materializeProcesses,
} from "./process-specs.js";

export type PlannedStepRun = {
  stepSpec: StepSpec;
  planReason: string;
  fingerprint: string;
  processes: Awaited<ReturnType<typeof materializeProcesses>>;
};

export const planStepRuns = async (input: {
  repositorySlug: string;
  stepSpecs: StepSpec[];
  changedFiles: string[];
  repository: {
    slug: string;
    areas: Array<{ key: string; pathPrefixes: string[] }>;
  };
  commitSha: string;
  requestedStepKeys?: string[];
}): Promise<PlannedStepRun[]> => {
  const changedAreaKeys = deriveAreaKeysFromChangedFiles(
    {
      slug: input.repository.slug,
      displayName: "",
      rootPath: "",
      defaultBranch: "",
      areas: input.repository.areas.map((area) => ({
        key: area.key,
        displayName: area.key,
        pathPrefixes: area.pathPrefixes,
      })),
    },
    input.changedFiles,
  );

  const relevantSteps = input.stepSpecs.filter((stepSpec) => {
    if (input.requestedStepKeys?.length) {
      return input.requestedStepKeys.includes(stepSpec.key);
    }

    return isProcessSpecRelevant(stepSpec, changedAreaKeys);
  });

  return Promise.all(
    relevantSteps.map(async (stepSpec) => {
      const processes = await materializeProcesses(stepSpec);

      return {
        stepSpec,
        planReason: stepSpec.alwaysRun
          ? "always-run baseline step"
          : `matched repo areas: ${stepSpec.observedAreaKeys
              .filter((areaKey) => changedAreaKeys.includes(areaKey))
              .join(", ")}`,
        fingerprint: computeExecutionFingerprint(
          input.repositorySlug,
          input.commitSha,
          stepSpec,
          processes,
        ),
        processes,
      };
    }),
  );
};
