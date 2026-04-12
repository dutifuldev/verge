import type { ProcessSpec } from "@verge/contracts";

import {
  computeExecutionFingerprint,
  deriveAreaKeysFromChangedFiles,
  isProcessSpecRelevant,
  materializeProcesses,
} from "./process-specs.js";

export type PlannedProcessSpecRun = {
  processSpec: ProcessSpec;
  planReason: string;
  fingerprint: string;
  processes: ReturnType<typeof materializeProcesses>;
};

export const planProcessSpecRuns = (input: {
  repositorySlug: string;
  processSpecs: ProcessSpec[];
  changedFiles: string[];
  repository: {
    slug: string;
    areas: Array<{ key: string; pathPrefixes: string[] }>;
  };
  commitSha: string;
  requestedProcessSpecKeys?: string[];
}): PlannedProcessSpecRun[] => {
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

  return input.processSpecs
    .filter((processSpec) => {
      if (input.requestedProcessSpecKeys?.length) {
        return input.requestedProcessSpecKeys.includes(processSpec.key);
      }

      return isProcessSpecRelevant(processSpec, changedAreaKeys);
    })
    .map((processSpec) => ({
      processSpec,
      planReason: processSpec.alwaysRun
        ? "always-run baseline process spec"
        : `matched repo areas: ${processSpec.observedAreaKeys
            .filter((areaKey) => changedAreaKeys.includes(areaKey))
            .join(", ")}`,
      fingerprint: computeExecutionFingerprint(input.repositorySlug, input.commitSha, processSpec),
      processes: materializeProcesses(processSpec),
    }));
};
