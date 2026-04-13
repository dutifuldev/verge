import { createHmac, timingSafeEqual } from "node:crypto";

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
