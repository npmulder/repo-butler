import path from "node:path";

import { buildDockerImage } from "./docker-manager";
import { resolvePathWithinRepo } from "./repo-paths";

export async function buildFromDockerfile(
  repoDir: string,
  dockerfilePath: string,
  options: {
    tag: string;
    labels?: Record<string, string>;
  },
): Promise<string> {
  const resolvedRepoDir = path.resolve(repoDir);

  return await buildDockerImage({
    contextDir: resolvedRepoDir,
    dockerfilePath: resolvePathWithinRepo(
      resolvedRepoDir,
      dockerfilePath,
      "Dockerfile path",
    ),
    tag: options.tag,
    labels: options.labels,
  });
}
