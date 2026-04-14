import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

type PushPayload = {
  commits: Array<{
    added: string[];
    modified: string[];
    removed: string[];
  }>;
};

export const collectChangedFilesFromPushPayload = (payload: PushPayload): string[] => {
  const changedFiles = new Set<string>();

  for (const commit of payload.commits) {
    for (const filePath of [...commit.added, ...commit.modified, ...commit.removed]) {
      changedFiles.add(filePath);
    }
  }

  return [...changedFiles];
};

export const validateGitHubSignature = (
  secret: string | undefined,
  rawBody: string | undefined,
  signatureHeader: string | undefined,
): boolean => {
  if (!secret) {
    return process.env.VERGE_ALLOW_UNVERIFIED_GITHUB_WEBHOOKS === "1";
  }

  if (!rawBody || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
};

export const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    return JSON.parse(value) as string[];
  }

  return [];
};

const runCommand = async (command: string, args: string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk: Buffer | string) => stdout.push(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderr.push(String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(stderr.join("").trim() || `${command} exited with ${code ?? 1}`));
        return;
      }

      resolve(stdout.join(""));
    });
  });

export const resolveCommitTitle = async (
  repositoryRootPath: string,
  commitSha: string,
  fallbackTitle?: string | null,
): Promise<string> => {
  if (fallbackTitle && fallbackTitle.trim().length > 0) {
    return fallbackTitle.trim().split("\n")[0] ?? fallbackTitle.trim();
  }

  try {
    const subject = await runCommand(
      "git",
      ["show", "-s", "--format=%s", commitSha],
      repositoryRootPath,
    );
    const normalized = subject.trim();
    if (normalized.length > 0) {
      return normalized.split("\n")[0] ?? normalized;
    }
  } catch {}

  return `Commit ${commitSha.slice(0, 7)}`;
};

export const sendSse = (reply: {
  raw: NodeJS.WritableStream & {
    writeHead?: (statusCode: number, headers: Record<string, string>) => void;
  };
}): void => {
  reply.raw.writeHead?.(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
};
