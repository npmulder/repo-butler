import fs from "node:fs/promises";
import path from "node:path";

export const GENERATED_DOCKERFILE_NAME = ".rb-generated-Dockerfile";

export interface ProjectDetection {
  language: "python" | "node";
  packageManager: "pip" | "poetry" | "pdm" | "npm" | "yarn" | "pnpm";
  installCommand: string;
  testCommand?: string;
  pythonVersion?: string;
  nodeVersion?: string;
}

export async function detectProject(
  repoDir: string,
  hints?: { language?: string; runtime?: string },
): Promise<ProjectDetection | null> {
  const entries = await fs.readdir(repoDir, { withFileTypes: true });
  const fileSet = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );

  const hintedLanguage = hints?.language?.toLowerCase();

  if (
    fileSet.has("pyproject.toml") ||
    fileSet.has("setup.py") ||
    fileSet.has("setup.cfg") ||
    fileSet.has("requirements.txt") ||
    hintedLanguage === "python"
  ) {
    return await detectPythonProject(repoDir, fileSet, hints?.runtime);
  }

  if (
    fileSet.has("package.json") ||
    hintedLanguage === "javascript" ||
    hintedLanguage === "typescript"
  ) {
    return await detectNodeProject(repoDir, fileSet, hints?.runtime);
  }

  return null;
}

export async function synthesizeDockerfile(
  repoDir: string,
  hints?: { language?: string; runtime?: string },
): Promise<{
  dockerfile: string;
  dockerfilePath: string;
  detection: ProjectDetection;
} | null> {
  const detection = await detectProject(repoDir, hints);

  if (!detection) {
    return null;
  }

  const dockerfile =
    detection.language === "python"
      ? generatePythonDockerfile(detection)
      : generateNodeDockerfile(detection);
  const dockerfilePath = getGeneratedDockerfilePath(repoDir);

  await fs.writeFile(dockerfilePath, dockerfile, "utf8");

  return {
    dockerfile,
    dockerfilePath,
    detection,
  };
}

export function getGeneratedDockerfilePath(repoDir: string): string {
  return path.join(repoDir, GENERATED_DOCKERFILE_NAME);
}

export function generatePythonDockerfile(detection: ProjectDetection): string {
  const baseImage = `python:${detection.pythonVersion ?? "3.12"}-slim`;
  const installCommand =
    detection.packageManager === "poetry"
      ? "pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-interaction --no-ansi"
      : detection.packageManager === "pdm"
        ? "pip install --no-cache-dir pdm && pdm config python.use_venv false && pdm install"
        : detection.installCommand;

  return [
    `FROM ${baseImage}`,
    "",
    "RUN apt-get update \\",
    "  && apt-get install -y --no-install-recommends build-essential git \\",
    "  && rm -rf /var/lib/apt/lists/*",
    "RUN groupadd --gid 1000 sandbox && useradd --uid 1000 --gid 1000 --create-home sandbox",
    "",
    "WORKDIR /workspace",
    "COPY . .",
    `RUN ${installCommand}`,
    "RUN chown -R sandbox:sandbox /workspace",
    "",
    "USER sandbox",
    "",
  ].join("\n");
}

export function generateNodeDockerfile(detection: ProjectDetection): string {
  const baseImage = `node:${detection.nodeVersion ?? "20"}-slim`;
  const corepackSetup =
    detection.packageManager === "pnpm" || detection.packageManager === "yarn"
      ? "RUN corepack enable"
      : undefined;

  return [
    `FROM ${baseImage}`,
    "",
    "RUN groupadd --gid 1000 sandbox && useradd --uid 1000 --gid 1000 --create-home sandbox",
    "",
    "WORKDIR /workspace",
    "COPY . .",
    ...(corepackSetup ? [corepackSetup] : []),
    `RUN ${detection.installCommand}`,
    "RUN chown -R sandbox:sandbox /workspace",
    "",
    "USER sandbox",
    "",
  ].join("\n");
}

async function detectPythonProject(
  repoDir: string,
  fileSet: Set<string>,
  runtimeHint?: string,
): Promise<ProjectDetection | null> {
  const pythonVersion = runtimeHint;

  if (fileSet.has("pyproject.toml")) {
    const content = await fs.readFile(
      path.join(repoDir, "pyproject.toml"),
      "utf8",
    );
    const usesPoetry = content.includes("[tool.poetry]");
    const usesPdm = content.includes("[tool.pdm]");

    return {
      language: "python",
      packageManager: usesPoetry ? "poetry" : usesPdm ? "pdm" : "pip",
      installCommand: usesPoetry
        ? "poetry install --no-interaction --no-ansi"
        : usesPdm
          ? "pdm install"
          : "pip install -e '.[test,dev]'",
      testCommand: "pytest",
      pythonVersion,
    };
  }

  if (fileSet.has("setup.py") || fileSet.has("setup.cfg")) {
    return {
      language: "python",
      packageManager: "pip",
      installCommand: "pip install -e '.[test,dev]'",
      testCommand: "pytest",
      pythonVersion,
    };
  }

  if (fileSet.has("requirements.txt")) {
    return {
      language: "python",
      packageManager: "pip",
      installCommand: "pip install -r requirements.txt",
      testCommand: "pytest",
      pythonVersion,
    };
  }

  return null;
}

async function detectNodeProject(
  repoDir: string,
  fileSet: Set<string>,
  runtimeHint?: string,
): Promise<ProjectDetection | null> {
  const nodeVersion = runtimeHint;
  const usesPnpm = fileSet.has("pnpm-lock.yaml");
  const usesYarn = fileSet.has("yarn.lock");
  const usesPackageLock =
    fileSet.has("package-lock.json") || fileSet.has("npm-shrinkwrap.json");
  let testCommand: string | undefined;

  if (fileSet.has("package.json")) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(repoDir, "package.json"), "utf8"),
      ) as { scripts?: { test?: string } };
      testCommand = pkg.scripts?.test
        ? usesPnpm
          ? "pnpm test"
          : usesYarn
            ? "yarn test"
            : "npm test"
        : undefined;
    } catch {
      testCommand = undefined;
    }
  } else {
    return null;
  }

  return {
    language: "node",
    packageManager: usesPnpm ? "pnpm" : usesYarn ? "yarn" : "npm",
    installCommand: usesPnpm
      ? "pnpm install --frozen-lockfile"
      : usesYarn
        ? "yarn install --frozen-lockfile"
        : usesPackageLock
          ? "npm ci"
          : "npm install",
    testCommand,
    nodeVersion,
  };
}
