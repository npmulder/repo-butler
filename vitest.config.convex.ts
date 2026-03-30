import path from "node:path";
import { defineConfig } from "vitest/config";

export const convexProject = {
  test: {
    name: "convex",
    include: ["__tests__/convex/**/*.test.ts"],
    environment: "edge-runtime",
  },
};

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  ...convexProject,
});
