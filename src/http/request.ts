export function parseId(value: string): number {
  return Number(value);
}

export function clampNumber(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}
