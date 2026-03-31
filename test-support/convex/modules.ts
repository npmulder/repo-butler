type ImportMetaWithGlob = ImportMeta & {
  glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
};

export const modules = (import.meta as ImportMetaWithGlob).glob([
  "../../convex/**/*.ts",
  "../../convex/_generated/**/*.js",
  // Keep Node-only tests out of Convex function discovery and codegen inputs.
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.spec.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/_generated/ai/**",
]);
