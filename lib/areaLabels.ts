export const AREA_LABEL_PREFIX = "area:";

export function normalizeAreaLabel(value: string) {
  let normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.toLowerCase().startsWith(AREA_LABEL_PREFIX)) {
    normalizedValue = normalizedValue.slice(AREA_LABEL_PREFIX.length);
  }

  const normalizedBody = normalizedValue.trim().toLowerCase().replace(/\s+/g, "-");

  if (!normalizedBody) {
    return null;
  }

  return `${AREA_LABEL_PREFIX}${normalizedBody}`;
}

export function normalizeAreaLabelValue(value: string) {
  const normalizedLabel = normalizeAreaLabel(value);
  return normalizedLabel ? normalizedLabel.slice(AREA_LABEL_PREFIX.length) : null;
}
