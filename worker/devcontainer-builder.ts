import fs from "node:fs/promises";
import path from "node:path";

import { buildDockerImage, ensureImageAvailable } from "./docker-manager";
import { resolvePathWithinRepo } from "./repo-paths";

export interface DevcontainerConfig {
  image?: string;
  dockerFile?: string;
  context?: string;
  build?: {
    dockerfile?: string;
    dockerFile?: string;
    context?: string;
    args?: Record<string, string>;
  };
  features?: Record<string, unknown>;
  postCreateCommand?: string | string[] | Record<string, string>;
  remoteUser?: string;
}

export interface DevcontainerBuildResult {
  image: string;
  setupCommands: string[];
  notes: string[];
}

export async function buildFromDevcontainer(
  repoDir: string,
  devcontainerPath: string,
  options: {
    tag: string;
    labels?: Record<string, string>;
  },
): Promise<DevcontainerBuildResult> {
  const resolvedConfigPath = resolvePathWithinRepo(
    repoDir,
    devcontainerPath,
    "devcontainer config path",
  );
  const config = await readDevcontainerConfig(resolvedConfigPath);
  const notes: string[] = [];
  const setupCommands = getPostCreateCommands(config);

  if (config.features && Object.keys(config.features).length > 0) {
    notes.push(
      "Devcontainer features are detected but not applied in this MVP builder.",
    );
  }

  if (config.image) {
    await ensureImageAvailable(config.image);
    return {
      image: config.image,
      setupCommands,
      notes,
    };
  }

  const configDir = path.dirname(resolvedConfigPath);
  const dockerfilePath =
    config.build?.dockerfile ?? config.build?.dockerFile ?? config.dockerFile;

  if (!dockerfilePath) {
    throw new Error(
      "devcontainer.json must declare either image or build/dockerFile",
    );
  }

  const contextDir = path.resolve(
    resolvePathWithinRepo(
      repoDir,
      config.build?.context ?? config.context ?? ".",
      "devcontainer build context",
      { baseDir: configDir, allowRepoRoot: true },
    ),
  );
  const image = await buildDockerImage({
    contextDir,
    dockerfilePath: resolvePathWithinRepo(
      repoDir,
      dockerfilePath,
      "devcontainer Dockerfile path",
      { baseDir: configDir },
    ),
    tag: options.tag,
    labels: options.labels,
    buildArgs: config.build?.args,
  });

  return {
    image,
    setupCommands,
    notes,
  };
}

export async function readDevcontainerConfig(
  devcontainerPath: string,
): Promise<DevcontainerConfig> {
  return parseDevcontainerConfig(await fs.readFile(devcontainerPath, "utf8"));
}

export function parseDevcontainerConfig(content: string): DevcontainerConfig {
  return JSON.parse(stripJsonComments(content)) as DevcontainerConfig;
}

export function stripJsonComments(value: string): string {
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < value.length) {
    const char = value[index];
    const next = value[index + 1];

    if (inString) {
      output += char;

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < value.length && value[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < value.length) {
        if (value[index] === "\n") {
          output += "\n";
        }

        if (value[index] === "*" && value[index + 1] === "/") {
          index += 2;
          break;
        }

        index += 1;
      }
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

export function getPostCreateCommands(config: DevcontainerConfig): string[] {
  const { postCreateCommand } = config;

  if (typeof postCreateCommand === "string") {
    return normalizeCommands([postCreateCommand]);
  }

  if (Array.isArray(postCreateCommand)) {
    return normalizeCommands(postCreateCommand);
  }

  if (postCreateCommand && typeof postCreateCommand === "object") {
    return normalizeCommands(
      Object.values(postCreateCommand).filter(
        (value): value is string => typeof value === "string",
      ),
    );
  }

  return [];
}

function normalizeCommands(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
