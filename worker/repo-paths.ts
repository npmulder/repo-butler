import path from "node:path";

export function normalizeRepoRelativePath(
  repoDir: string,
  candidatePath: string,
  description: string,
  options: { baseDir?: string; allowRepoRoot?: boolean } = {},
): string {
  if (path.isAbsolute(candidatePath)) {
    throw new Error(
      `Invalid ${description}: absolute paths are not allowed (${candidatePath})`,
    );
  }

  const resolved = resolvePathWithinRepo(repoDir, candidatePath, description, options);
  const relativePath = path.relative(path.resolve(repoDir), resolved);

  return relativePath === ""
    ? "."
    : relativePath.split(path.sep).join(path.posix.sep);
}

export function resolvePathWithinRepo(
  repoDir: string,
  candidatePath: string,
  description: string,
  options: { baseDir?: string; allowRepoRoot?: boolean } = {},
): string {
  const repoRoot = path.resolve(repoDir);
  const baseDir = options.baseDir
    ? path.resolve(options.baseDir)
    : repoRoot;
  const resolved = path.resolve(baseDir, candidatePath);
  const relativeToRepo = path.relative(repoRoot, resolved);
  const escapesRepo =
    relativeToRepo.startsWith("..") || path.isAbsolute(relativeToRepo);

  if (escapesRepo || (relativeToRepo === "" && !options.allowRepoRoot)) {
    throw new Error(
      `Invalid ${description}: ${candidatePath} resolves outside the repository`,
    );
  }

  return resolved;
}
