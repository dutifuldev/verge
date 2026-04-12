import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FilesystemArtifactStorage } from "./storage.js";

describe("FilesystemArtifactStorage", () => {
  it("writes text artifacts under the configured root", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "verge-storage-"));
    const storage = new FilesystemArtifactStorage(rootPath);

    const artifact = await storage.writeText({
      relativePath: "runs/example/log.txt",
      content: "hello verge",
    });

    expect(artifact.storagePath).toContain(path.join("runs", "example", "log.txt"));
    await expect(readFile(artifact.storagePath, "utf8")).resolves.toBe("hello verge");
  });
});
