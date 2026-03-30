export function parseHeader(input: string): string[] {
  if (input.trim().length === 0) {
    throw new Error("Unexpected empty input");
  }

  return input
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
}
