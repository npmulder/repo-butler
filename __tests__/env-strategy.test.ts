// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectProject,
  synthesizeDockerfile,
} from "../worker/bootstrap-builder";
import {
  parseDevcontainerConfig,
  stripJsonComments,
} from "../worker/devcontainer-builder";
import {
  detectEnvironmentStrategy,
  selectBaseImage,
} from "../worker/env-strategy";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("detectEnvironmentStrategy", () => {
  it("detects a devcontainer in the default location", async () => {
    const repoDir = await createTempRepo({
      ".devcontainer/devcontainer.json": '{ "image": "node:20-slim" }',
    });

    const plan = await detectEnvironmentStrategy(repoDir);

    expect(plan.strategy).toBe("devcontainer");
    expect(plan.dockerfilePath).toBe(
      path.join(repoDir, ".devcontainer/devcontainer.json"),
    );
    expect(plan.notes).toContain(".devcontainer/devcontainer.json");
  });

  it("detects a Dockerfile when no devcontainer is present", async () => {
    const repoDir = await createTempRepo({
      Dockerfile: "FROM node:20-slim\n",
    });

    const plan = await detectEnvironmentStrategy(repoDir);

    expect(plan.strategy).toBe("dockerfile");
    expect(plan.dockerfilePath).toBe(path.join(repoDir, "Dockerfile"));
  });

  it("detects a Python project for synthesized Dockerfile generation", async () => {
    const repoDir = await createTempRepo({
      "pyproject.toml": [
        "[project]",
        'name = "example"',
        'version = "0.1.0"',
      ].join("\n"),
    });

    const detection = await detectProject(repoDir, {
      language: "python",
      runtime: "3.11",
    });
    const plan = await detectEnvironmentStrategy(repoDir, {
      language: "python",
      runtime: "3.11",
    });
    const synthesized = await synthesizeDockerfile(repoDir, {
      language: "python",
      runtime: "3.11",
    });

    expect(detection).toEqual(
      expect.objectContaining({
        language: "python",
        packageManager: "pip",
        installCommand: "pip install -e '.[test,dev]'",
        testCommand: "pytest",
        pythonVersion: "3.11",
      }),
    );
    expect(plan.strategy).toBe("synth_dockerfile");
    expect(synthesized?.dockerfile).toContain("FROM python:3.11-slim");
    expect(synthesized?.dockerfile).toContain("pip install -e '.[test,dev]'");
  });

  it("detects a Node project and prefers yarn when yarn.lock is present", async () => {
    const repoDir = await createTempRepo({
      "package.json": JSON.stringify(
        {
          name: "example",
          private: true,
          scripts: {
            test: "vitest run",
          },
        },
        null,
        2,
      ),
      "yarn.lock": "",
    });

    const detection = await detectProject(repoDir, {
      language: "typescript",
      runtime: "22",
    });
    const synthesized = await synthesizeDockerfile(repoDir, {
      language: "typescript",
      runtime: "22",
    });

    expect(detection).toEqual(
      expect.objectContaining({
        language: "node",
        packageManager: "yarn",
        installCommand: "yarn install --frozen-lockfile",
        testCommand: "yarn test",
        nodeVersion: "22",
      }),
    );
    expect(synthesized?.dockerfile).toContain("FROM node:22-slim");
    expect(synthesized?.dockerfile).toContain("RUN corepack enable");
    expect(synthesized?.dockerfile).toContain(
      "RUN yarn install --frozen-lockfile",
    );
  });

  it("falls back to bootstrap when the repository has no container or project metadata", async () => {
    const repoDir = await createTempRepo({});

    const plan = await detectEnvironmentStrategy(repoDir);

    expect(plan).toEqual(
      expect.objectContaining({
        strategy: "bootstrap",
        image: "ubuntu:22.04",
      }),
    );
  });

  it("prefers devcontainer over Dockerfile when both are present", async () => {
    const repoDir = await createTempRepo({
      ".devcontainer/devcontainer.json": '{ "image": "node:20-slim" }',
      Dockerfile: "FROM node:20-slim\n",
    });

    const plan = await detectEnvironmentStrategy(repoDir);

    expect(plan.strategy).toBe("devcontainer");
  });
});

describe("devcontainer parsing", () => {
  it("parses JSONC devcontainer config with line and block comments", () => {
    const config = parseDevcontainerConfig(
      [
        "// comment before config",
        "{",
        '  "image": "mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye",',
        '  /* inline block comment */ "postCreateCommand": ["pnpm install", "pnpm test"],',
        '  "remoteUser": "vscode"',
        "}",
      ].join("\n"),
    );

    expect(config.image).toBe(
      "mcr.microsoft.com/devcontainers/typescript-node:1-20-bullseye",
    );
    expect(config.postCreateCommand).toEqual(["pnpm install", "pnpm test"]);
    expect(config.remoteUser).toBe("vscode");
  });

  it("does not strip URL-like strings while removing comments", () => {
    const stripped = stripJsonComments(
      [
        "{",
        '  "documentationUrl": "https://example.com/docs",',
        "  // trailing comment",
        '  "image": "node:20-slim"',
        "}",
      ].join("\n"),
    );

    expect(stripped).toContain(
      '"documentationUrl": "https://example.com/docs"',
    );
    expect(stripped).not.toContain("trailing comment");
  });
});

describe("Dockerfile synthesis", () => {
  it("generates a Dockerfile with a non-root user and install command", async () => {
    const repoDir = await createTempRepo({
      "requirements.txt": "pytest==8.3.0\n",
    });

    const synthesized = await synthesizeDockerfile(repoDir, {
      language: "python",
      runtime: "3.12",
    });

    expect(synthesized).not.toBeNull();
    expect(synthesized?.dockerfile).toContain("useradd --uid 1000");
    expect(synthesized?.dockerfile).toContain("USER sandbox");
    expect(synthesized?.dockerfile).toContain(
      "RUN pip install -r requirements.txt",
    );
  });

  it("selects language-specific base images for bootstrap fallback hints", () => {
    expect(selectBaseImage({ language: "python", runtime: "3.10" })).toBe(
      "python:3.10-slim",
    );
    expect(selectBaseImage({ language: "typescript", runtime: "22" })).toBe(
      "node:22-slim",
    );
  });
});

async function createTempRepo(files: Record<string, string>): Promise<string> {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-strategy-"));
  tempDirs.push(repoDir);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(repoDir, relativePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents, "utf8");
    }),
  );

  return repoDir;
}
