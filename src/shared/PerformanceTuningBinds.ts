// Validates the user's optional "representative bind values" for a
// placeholder SQL selected from Query Statistics (PostgreSQL `$1`, MySQL
// `?`, Oracle `:1`, SQL Server parameter references - the exact syntax/count
// is never inferred here, see
// misc/design/performance-tuning-context-implementation-plan.ja.md §10 Phase 5
// "正規化SQLと代表bind値"). Values now always arrive as strings from
// BindParametersEditor.vue's per-row inputs (misc/design/performance-tuning-
// query-statistics-parameter-input-plan.ja.md §7.4/§7.6 removed the free-text
// JSON textarea this used to validate as its main caller), but this stays
// the one shared scalar-array check ToolsViewProvider runs right before
// `plan.binds` reaches `getPerformanceTuningContext()`.
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
