// Validates representative bind values before they reach
// getPerformanceTuningContext().
export type PlanBindValue = string | number | boolean | null;

export type PlanBindsValidationResult =
  | { ok: true; binds: PlanBindValue[] }
  | { ok: false; message: string };

// A JS array of plain scalars only - object/nested-array elements are
// rejected outright rather than silently stringified or dropped, since a
// silently-mangled bind value would make the collected plan look valid
// while quietly analyzing the wrong statement.
export function validatePlanBindsInput(raw: unknown): PlanBindsValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'Bind values must be a JSON array, e.g. [1, "active"].' };
  }
  const binds: PlanBindValue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      binds.push(v);
      continue;
    }
    return {
      ok: false,
      message: `Bind value at index ${i} must be a string, number, boolean, or null.`,
    };
  }
  return { ok: true, binds };
}
