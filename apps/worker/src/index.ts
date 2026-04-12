import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import type { ClaimedRunProcess, RunDetail } from "@verge/contracts";
import { FilesystemArtifactStorage } from "@verge/core";

const apiBaseUrl = process.env.VERGE_API_URL ?? "http://127.0.0.1:8787";
const workerId = process.env.VERGE_WORKER_ID ?? `worker-${randomUUID()}`;
const once = process.argv.includes("--once");
const storage = new FilesystemArtifactStorage();

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export const normalizeObservationAreaKeys = (areaKeys: string[]): Array<string | null> =>
  areaKeys.length > 0 ? areaKeys : [null];

const postJson = async <T>(urlPath: string, payload: unknown): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${urlPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${urlPath}: ${response.status}`);
  }

  return (await response.json()) as T;
};

const getJson = async <T>(urlPath: string): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${urlPath}`);
  if (!response.ok) {
    throw new Error(`Request failed for ${urlPath}: ${response.status}`);
  }
  return (await response.json()) as T;
};

const executeProcess = async (assignment: ClaimedRunProcess): Promise<number> => {
  const artifactDir = path.join("runs", assignment.runId);
  const heartbeat = setInterval(() => {
    void postJson(`/workers/${assignment.runId}/heartbeat`, {
      workerId,
      runProcessId: assignment.runProcessId,
    });
  }, 5000);

  await postJson(`/workers/${assignment.runId}/events`, {
    workerId,
    runProcessId: assignment.runProcessId,
    kind: "started",
    message: `Started ${assignment.processLabel}`,
  });

  const output: string[] = [];

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const [command, ...args] = assignment.command;
      if (!command) {
        reject(new Error(`Missing command for ${assignment.processKey}`));
        return;
      }

      const child = spawn(command, args, {
        cwd: assignment.repositoryRootPath,
        env: {
          ...process.env,
          VERGE_PROCESS_KEY: assignment.processKey,
          VERGE_RUN_ID: assignment.runId,
          VERGE_RUN_PROCESS_ID: assignment.runProcessId,
        },
      });

      child.stdout?.on("data", (chunk: Buffer | string) => output.push(String(chunk)));
      child.stderr?.on("data", (chunk: Buffer | string) => output.push(String(chunk)));
      child.on("error", reject);
      child.on("close", (code: number | null) => resolve(code ?? 1));
    });

    const logArtifact = await storage.writeText({
      relativePath: path.join(artifactDir, `${assignment.processKey}.log`),
      content: output.join(""),
    });

    await postJson(`/workers/${assignment.runId}/artifacts`, {
      workerId,
      runProcessId: assignment.runProcessId,
      artifactKey: "log",
      storagePath: logArtifact.storagePath,
      mediaType: "text/plain",
      metadata: {
        processKey: assignment.processKey,
      },
    });

    const observationStatus = exitCode === 0 ? "passed" : "failed";
    const areaKeys = normalizeObservationAreaKeys(assignment.areaKeys);

    for (const areaKey of areaKeys) {
      await postJson(`/workers/${assignment.runId}/observations`, {
        workerId,
        runProcessId: assignment.runProcessId,
        processKey: assignment.processKey,
        areaKey,
        status: observationStatus,
        summary: {
          processKey: assignment.processKey,
          exitCode,
        },
        executionScope: {
          workerId,
          command: assignment.command,
        },
      });
    }

    await postJson(`/workers/${assignment.runId}/events`, {
      workerId,
      runProcessId: assignment.runProcessId,
      kind: exitCode === 0 ? "passed" : "failed",
      message: `${assignment.processLabel} ${exitCode === 0 ? "passed" : "failed"}`,
      payload: {
        exitCode,
      },
    });

    if (assignment.checkpointEnabled) {
      const runDetail = await getJson<RunDetail>(`/runs/${assignment.runId}`);
      const completedProcessKeys = runDetail.processes
        .filter((process) => ["passed", "reused", "skipped"].includes(process.status))
        .map((process) => process.processKey);
      const pendingProcessKeys = runDetail.processes
        .filter((process) => ["queued", "claimed", "running"].includes(process.status))
        .map((process) => process.processKey);
      const checkpointArtifact = await storage.writeText({
        relativePath: path.join(artifactDir, `${assignment.processKey}-checkpoint.json`),
        content: JSON.stringify(
          {
            completedProcessKeys,
            pendingProcessKeys,
          },
          null,
          2,
        ),
      });

      await postJson(`/workers/${assignment.runId}/checkpoints`, {
        workerId,
        completedProcessKeys,
        pendingProcessKeys,
        storagePath: checkpointArtifact.storagePath,
        resumableUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    }

    return exitCode;
  } finally {
    clearInterval(heartbeat);
  }
};

const main = async (): Promise<void> => {
  while (true) {
    const claim = await postJson<{ assignment: ClaimedRunProcess | null }>("/workers/claim", {
      workerId,
    });

    if (!claim.assignment) {
      if (once) {
        return;
      }
      await sleep(1000);
      continue;
    }

    const exitCode = await executeProcess(claim.assignment);
    if (once) {
      process.exitCode = exitCode;
      return;
    }
  }
};

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
