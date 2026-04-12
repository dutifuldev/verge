import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type StorageWriteInput = {
  relativePath: string;
  content: string;
};

export type StorageWriteResult = {
  storagePath: string;
};

export interface ArtifactStorage {
  writeText(input: StorageWriteInput): Promise<StorageWriteResult>;
}

export class FilesystemArtifactStorage implements ArtifactStorage {
  constructor(private readonly rootPath = path.resolve(".verge-artifacts")) {}

  async writeText(input: StorageWriteInput): Promise<StorageWriteResult> {
    const storagePath = path.resolve(this.rootPath, input.relativePath);
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, input.content, "utf8");
    return { storagePath };
  }
}
