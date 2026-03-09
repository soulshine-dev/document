export const DIPLOMA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

export function normalizeDiplomaId(value: string): string {
  return value.trim().slice(0, 64);
}

export function isValidDiplomaId(value: string): boolean {
  return DIPLOMA_ID_PATTERN.test(normalizeDiplomaId(value));
}

export function sanitizeText(value: string, maxLen: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLen);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
