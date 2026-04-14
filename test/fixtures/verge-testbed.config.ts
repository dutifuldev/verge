import { defineVergeConfig } from "../../packages/core/src/config.js";

export default defineVergeConfig({
  repository: {
    slug: "verge-testbed",
    displayName: "Verge Testbed",
    rootPath: "../../",
    defaultBranch: "main",
    areas: [
      {
        key: "resume",
        displayName: "Resume",
        pathPrefixes: ["fixtures/resume/"],
      },
    ],
  },
  steps: [
    {
      key: "test-resume",
      displayName: "Resume Tests",
      description: "Integration fixture for converged commit state and checkpoint resume.",
      kind: "test",
      baseCommand: ["pnpm", "exec", "vitest", "run"],
      cwd: ".",
      observedAreaKeys: ["resume"],
      materialization: {
        kind: "namedProcesses",
        processes: [
          {
            key: "resume::fixtures/resume/flow.resume.test.ts::resume fixture > fails once and then passes on resume",
            displayName: "resume fixture > fails once and then passes on resume",
            kind: "test",
            areaKeys: ["resume"],
            filePath: "fixtures/resume/flow.resume.test.ts",
            extraArgs: [],
          },
          {
            key: "resume::fixtures/resume/flow.resume.test.ts::resume fixture > passes after the fail-once process",
            displayName: "resume fixture > passes after the fail-once process",
            kind: "test",
            areaKeys: ["resume"],
            filePath: "fixtures/resume/flow.resume.test.ts",
            extraArgs: [],
          },
          {
            key: "resume::fixtures/resume/flow.resume.test.ts::resume fixture > passes the first baseline process",
            displayName: "resume fixture > passes the first baseline process",
            kind: "test",
            areaKeys: ["resume"],
            filePath: "fixtures/resume/flow.resume.test.ts",
            extraArgs: [],
          },
          {
            key: "resume::fixtures/resume/flow.resume.test.ts::resume fixture > passes the second baseline process",
            displayName: "resume fixture > passes the second baseline process",
            kind: "test",
            areaKeys: ["resume"],
            filePath: "fixtures/resume/flow.resume.test.ts",
            extraArgs: [],
          },
        ],
      },
      reuseEnabled: true,
      checkpointEnabled: true,
      alwaysRun: false,
    },
  ],
});
