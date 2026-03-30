type ImportMetaWithGlob = ImportMeta & {
  glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
};

export const modules = (import.meta as ImportMetaWithGlob).glob([
  "../../convex/**/*.ts",
  "../../convex/_generated/**/*.js",
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/_generated/ai/**",
]);
