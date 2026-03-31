import { readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function listFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return await listFiles(fullPath);
      }
      return [fullPath];
    }),
  );

  return files.flat();
}

describe("Convex source layout", () => {
  it("keeps test files out of convex/", async () => {
    const repoRoot = path.resolve(__dirname, "..");
    const convexDir = path.join(repoRoot, "convex");
    const files = await listFiles(convexDir);

    const testFiles = files
      .filter((file) => /\.(test|spec)\.ts$/.test(file))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));

    expect(testFiles).toEqual([]);
  });
});
