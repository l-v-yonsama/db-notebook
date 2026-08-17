// Validates the user's optional "representative bind values" for a
// placeholder SQL selected from Query Statistics (PostgreSQL `$1`, MySQL
// `?`, Oracle `:1`, SQL Server parameter references - the exact syntax/count
// is never inferred here, see
// misc/design/performance-tuning-context-implementation-plan.ja.md §10 Phase 5
// "正規化SQLと代表bind値"). Shared between the webview (immediate form
// feedback) and the extension host (the actual trust boundary right before
// `plan.binds` reaches `getPerformanceTuningContext()`) so both sides apply
// the exact same rule rather than two hand-written copies drifting apart.
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

// Parses the webview's free-text "Plan parameters (optional)" field (an
// editable JSON array) and validates it in one step. Empty input is valid -
// it means "no representative values", not "invalid JSON" - matching §10
// Phase 5's "初期値は空配列で、自動推測しない".
export function parsePlanBindsText(text: string): PlanBindsValidationResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, binds: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'Bind values must be valid JSON, e.g. [1, "active"].' };
  }
  return validatePlanBindsInput(parsed);
}
