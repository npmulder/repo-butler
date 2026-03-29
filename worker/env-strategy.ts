import fs from "node:fs/promises";
import path from "node:path";

import { detectProject, GENERATED_DOCKERFILE_NAME } from "./bootstrap-builder";
import {
  normalizeRepoRelativePath,
  resolvePathWithinRepo,
} from "./repo-paths";

export type StrategyType =
  | "devcontainer"
  | "dockerfile"
  | "synth_dockerfile"
  | "bootstrap";

export interface EnvironmentPlan {
  strategy: StrategyType;
  image?: string;
  devcontainerPath?: string;
  dockerfilePath?: string;
  buildContext?: string;
  notes: string;
}

export const STRATEGY_PRIORITY: StrategyType[] = [
  "devcontainer",
  "dockerfile",
  "synth_dockerfile",
  "bootstrap",
];

export async function detectEnvironmentStrategy(
  repoDir: string,
  hints?: {
    language?: string;
    runtime?: string;
    devcontainerPath?: string;
    dockerfilePath?: string;
  },
): Promise<EnvironmentPlan> {
  const devcontainerPaths = uniquePaths([
    hints?.devcontainerPath
      ? normalizeRepoRelativePath(
          repoDir,
          hints.devcontainerPath,
          "devcontainer path hint",
        )
      : undefined,
    ".devcontainer/devcontainer.json",
    ".devcontainer.json",
  ]);

  for (const relativePath of devcontainerPaths) {
    const fullPath = resolvePathWithinRepo(
      repoDir,
      relativePath,
      "devcontainer path",
    );
    if (await fileExists(fullPath)) {
      return {
        strategy: "devcontainer",
        devcontainerPath: relativePath,
        buildContext: path.posix.dirname(relativePath),
        notes: `Found devcontainer at ${relativePath}`,
      };
    }
  }

  const dockerfilePaths = uniquePaths([
    hints?.dockerfilePath
      ? normalizeRepoRelativePath(
          repoDir,
          hints.dockerfilePath,
          "Dockerfile path hint",
        )
      : undefined,
    "Dockerfile",
    "docker/Dockerfile",
    ".docker/Dockerfile",
    "Dockerfile.dev",
  ]);

  for (const relativePath of dockerfilePaths) {
    const fullPath = resolvePathWithinRepo(
      repoDir,
      relativePath,
      "Dockerfile path",
    );
    if (await fileExists(fullPath)) {
      return {
        strategy: "dockerfile",
        dockerfilePath: relativePath,
        buildContext: ".",
        notes: `Found Dockerfile at ${relativePath}`,
      };
    }
  }

  const project = await detectProject(repoDir, hints);
  if (project) {
    return {
      strategy: "synth_dockerfile",
      dockerfilePath: GENERATED_DOCKERFILE_NAME,
      buildContext: ".",
      notes: `Synthesizing Dockerfile for detected ${project.language} project (${project.packageManager})`,
    };
  }

  return {
    strategy: "bootstrap",
    image: process.env.SANDBOX_BASE_IMAGE ?? selectBaseImage(hints),
    notes:
      "No container config found; using a generic base image with bootstrap commands",
  };
}

export function getFallbackStrategies(strategy: StrategyType): StrategyType[] {
  const index = STRATEGY_PRIORITY.indexOf(strategy);
  return index === -1 ? [] : STRATEGY_PRIORITY.slice(index + 1);
}

export function normalizeStrategy(strategy?: string): StrategyType | undefined {
  switch (strategy) {
    case "devcontainer":
    case "dockerfile":
    case "synth_dockerfile":
    case "bootstrap":
      return strategy;
    case "repo2run_synth":
      return "synth_dockerfile";
    case "manual_bootstrap":
      return "bootstrap";
    default:
      return undefined;
  }
}

export function selectBaseImage(hints?: {
  language?: string;
  runtime?: string;
}): string {
  const language = hints?.language?.toLowerCase();

  switch (language) {
    case "python":
      return `python:${hints?.runtime ?? "3.12"}-slim`;
    case "javascript":
    case "typescript":
      return `node:${hints?.runtime ?? "20"}-slim`;
    case "ruby":
      return `ruby:${hints?.runtime ?? "3.3"}-slim`;
    case "go":
      return `golang:${hints?.runtime ?? "1.22"}-bookworm`;
    case "java":
      return `eclipse-temurin:${hints?.runtime ?? "21"}-jdk-jammy`;
    case "rust":
      return `rust:${hints?.runtime ?? "1.77"}-slim`;
    default:
      return "ubuntu:22.04";
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}
