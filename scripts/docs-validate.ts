import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const DOCS_DIR = path.resolve("docs");

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk(fullPath);
      }
      return fullPath.endsWith(".md") ? [fullPath] : [];
    }),
  );

  return files.flat();
};

const ensureFrontmatter = (content: string, filePath: string): void => {
  if (!content.startsWith("---\n")) {
    throw new Error(`${filePath} is missing frontmatter`);
  }

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error(`${filePath} has malformed frontmatter`);
  }

  const frontmatter = match[1];
  for (const key of ["date:", "title:", "tags:"]) {
    if (!frontmatter.includes(key)) {
      throw new Error(`${filePath} is missing frontmatter key ${key}`);
    }
  }
};

const ensureLinks = async (content: string, filePath: string): Promise<void> => {
  const links = Array.from(content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g), (match) => match[1]);
  for (const link of links) {
    if (!link.startsWith("./")) {
      continue;
    }
    const target = path.resolve(path.dirname(filePath), link);
    if (!target.startsWith(DOCS_DIR)) {
      throw new Error(`${filePath} contains an out-of-docs relative link: ${link}`);
    }
    try {
      await access(target);
    } catch {
      throw new Error(`${filePath} contains a missing relative doc link: ${link}`);
    }
  }
};

const main = async (): Promise<void> => {
  const files = await walk(DOCS_DIR);
  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    ensureFrontmatter(content, filePath);
    await ensureLinks(content, filePath);
  }

  console.log(`Validated ${files.length} docs files.`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
