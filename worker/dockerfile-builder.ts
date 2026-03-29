import path from "node:path";

import { buildDockerImage } from "./docker-manager";

export async function buildFromDockerfile(
  repoDir: string,
  dockerfilePath: string,
  options: {
    tag: string;
    labels?: Record<string, string>;
  },
): Promise<string> {
  return await buildDockerImage({
    contextDir: repoDir,
    dockerfilePath: path.resolve(repoDir, dockerfilePath),
    tag: options.tag,
    labels: options.labels,
  });
}
