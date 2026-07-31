/** JS allows `throw`ing anything, so callers can't assume a caught value has a `.message`. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
