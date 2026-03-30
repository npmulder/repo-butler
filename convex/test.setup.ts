type ImportMetaWithGlob = ImportMeta & {
  glob: (pattern: string | string[]) => Record<string, () => Promise<unknown>>;
};

export const modules = (import.meta as ImportMetaWithGlob).glob([
  "./**/*.ts",
  "./_generated/**/*.js",
  "!./**/*.test.ts",
  "!./**/*.config.ts",
  "!./_generated/ai/**",
  "!./test.setup.ts",
  "!./testHelpers.ts",
]);
