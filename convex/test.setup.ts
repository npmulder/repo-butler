type ImportMetaWithGlob = ImportMeta & {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
};

export const modules = (import.meta as ImportMetaWithGlob).glob(
  "./**/!(*.*.*)*.*s",
);
