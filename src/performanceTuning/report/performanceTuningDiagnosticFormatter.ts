import type {
  PerformanceTuningDiagnostic,
  PerformanceTuningDiagnosticCode,
  UnavailableSection,
  UnavailableSectionName,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  PerformanceTuningDiagnosticDetailViewModel,
  PerformanceTuningDiagnosticGroupViewModel,
} from "../../shared/MessageEventData";

// Converts raw diagnostics into concise user-facing groups. Stable driver
// codes select the wording; unknown values still retain their raw message.
// Every input item remains available in exactly one group's details.

const SEVERITY_ORDER: Record<"info" | "warning", number> = { info: 0, warning: 1 };

const OBJECT_KIND_LABEL: Record<
  NonNullable<NonNullable<PerformanceTuningDiagnostic["node"]>["objectKind"]>,
  string
> = {
  function: "a function",
  values: "a fixed list of values (VALUES)",
  cte: "a common table expression (CTE)",
  workTable: "a recursive query's working table",
  subquery: "a subquery or derived table",
  table: "a table", // not expected for NON_TABLE_PLAN_SOURCE, kept for type completeness
  index: "an index",
};

// Shared between SECTION_COLLECTION_FAILED/COLLECTION_TRUNCATED diagnostics
// and UnavailableSection.section - both use the exact same stable vocabulary
// (UnavailableSectionName minus nothing; diagnostics never carry
// 'analyzedExecutionPlan' today, but the label exists in case that changes).
// Two forms are kept explicit (rather than deriving one from the other by
// string surgery) since they don't share a mechanical transformation: mid-
// sentence form always reads naturally after "some"/"for", while the title
// form is a standalone noun phrase.
//
// Deliberately article-free (no leading "the"): every mid-sentence use below
// already supplies its own "Some " (e.g. "Some table definition details for
// public.orders ...") - prepending "the" on top of that reads as "Some the
// table definition ...", which is wrong English. The two originally-singular
// labels (executionPlan/tableDefinition) are phrased as "... details" so
// they also agree in number with a verb like "were shortened", matching the
// naturally-plural labels (tableStatistics/columnStatistics/physicalHealth).
const SECTION_LABEL: Record<UnavailableSectionName, string> = {
  executionPlan: "execution plan details",
  analyzedExecutionPlan: "analyzed execution plan details",
  tableDefinition: "table definition details",
  tableStatistics: "table statistics",
  columnStatistics: "column statistics",
  physicalHealth: "physical health metrics",
};
const SECTION_TITLE_LABEL: Record<UnavailableSectionName, string> = {
  executionPlan: "Execution plan",
  analyzedExecutionPlan: "Analyzed execution plan",
  tableDefinition: "Table definition",
  tableStatistics: "Table statistics",
  columnStatistics: "Column statistics",
  physicalHealth: "Physical health metrics",
};

// What collection typically depends on each section - used to give a
// concrete, honest "impact" sentence even when the only information this
// driver has is a free-text reason it deliberately does not parse.
const SECTION_IMPACT: Record<UnavailableSectionName, string> = {
  executionPlan: "Plan-based analysis cannot continue for this statement.",
  analyzedExecutionPlan: "Only the estimated plan is available; actual run-time figures are not.",
  tableDefinition: "Column, constraint, and index details are unavailable for this table.",
  tableStatistics: "Row-count and size estimates are unavailable for this table.",
  columnStatistics: "Row-count estimates for the filtered/joined columns may be less accurate.",
  physicalHealth: "Physical health signals (e.g. bloat, fragmentation) are unavailable for this table.",
};

const tableRef = (schemaName: string | undefined, tableName: string | undefined): string | undefined =>
  tableName ? [schemaName, tableName].filter(Boolean).join(".") : undefined;

const pluralize = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

const detailFromDiagnostic = (d: PerformanceTuningDiagnostic): PerformanceTuningDiagnosticDetailViewModel => ({
  nodeId: d.node?.id,
  operation: d.node?.operation,
  objectName: d.node?.objectName,
  schemaName: d.schemaName,
  tableName: d.tableName,
  // Always non-empty: `message` is a required field on every diagnostic
  // (§2's "Driver側のtechnical fallback。UIが未知のcodeでも情報を隠さないた
  // め必須。"), so a detail row is never blank even for an unrecognized code.
  technicalMessage: d.message,
});

// Groups diagnostics that share the same underlying "why" so the summary
// isn't repeated once per plan node (§1.1). The grouping granularity is
// intentionally code-specific: NON_TABLE_PLAN_SOURCE groups coarsely (by
// object kind - "every Function Scan reads the same way", regardless of
// which function), while table-scoped warnings group per table (a caveat on
// customers' statistics is a different story from one on orders').
function groupKeyOf(d: PerformanceTuningDiagnostic): string {
  switch (d.code) {
    case "NON_TABLE_PLAN_SOURCE":
      return `${d.code}:${d.node?.objectKind ?? "unknown"}`;
    case "PLAN_OBSERVATION":
      // Standardized flag text (e.g. MySQL's "Uses filesort.") naturally
      // groups across nodes; a vendor-native, per-node message (e.g. SQL
      // Server's "NO STATS: (...)") naturally stays its own singleton group
      // instead, since the text itself already differs per node.
      return `${d.code}:${d.message}`;
    case "TABLE_MAPPING_FAILED":
    case "SECTION_COLLECTION_FAILED":
    case "COLLECTION_TRUNCATED":
      return `${d.code}:${d.scope}:${d.schemaName ?? ""}:${d.tableName ?? ""}`;
    default:
      // DATABASE_VERSION_UNAVAILABLE and any future/unrecognized code: one
      // group per code is the safest default (never over-merges different
      // codes together).
      return d.code;
  }
}

function titleAndSummaryForDiagnosticGroup(
  code: PerformanceTuningDiagnosticCode | string,
  members: PerformanceTuningDiagnostic[],
): { title: string; summary: string } {
  const first = members[0];
  const count = members.length;

  switch (code) {
    case "NON_TABLE_PLAN_SOURCE": {
      const kindLabel = first.node?.objectKind ? OBJECT_KIND_LABEL[first.node.objectKind] : "a non-table source";
      return {
        title: "Reads from a non-table source",
        summary:
          `${count} ${pluralize(count, "step", "steps")} in this execution plan ` +
          `${pluralize(count, "reads", "read")} from ${kindLabel} rather than a physical table. ` +
          `Table definitions and statistics do not apply to ${pluralize(count, "this step", "these steps")}. ` +
          `No action is required.`,
      };
    }
    case "PLAN_OBSERVATION":
      // 2026-08-20 follow-up: this used to also restate, per group, "this
      // characteristic alone does not indicate a confirmed performance
      // problem" - correct, but with several distinct PLAN_OBSERVATION
      // groups on one plan (one per distinct message text, e.g. "Uses
      // filesort." / "Uses a temporary table." / "Uses a join buffer (hash
      // join)."), the identical sentence stacked up several times, making the
      // Information section a lot taller than its actual content. That
      // framing sentence now lives once, above every group, in
      // PerformanceTuningPreviewPanel.vue's Information section header - this
      // summary only states what was found.
      return {
        title: "Plan observation",
        summary: `The execution plan reports the following ${pluralize(count, "characteristic", "characteristics")}.`,
      };
    case "TABLE_MAPPING_FAILED":
      return {
        title: "Some plan steps could not be matched to a table",
        summary:
          `${count} ${pluralize(count, "step", "steps")} in this execution plan could not be matched to a ` +
          `specific table. Row-count estimates and other table-specific context are unavailable for ` +
          `${pluralize(count, "it", "them")}; the rest of the analysis can continue.`,
      };
    case "SECTION_COLLECTION_FAILED": {
      const section = first.section;
      const sectionLabel = section ? SECTION_LABEL[section] : "some information";
      const ref = tableRef(first.schemaName, first.tableName);
      return {
        title: `${section ? SECTION_TITLE_LABEL[section] : "Some data"} could not be fully collected`,
        summary:
          `Some ${sectionLabel} for ${ref ?? "this table"} could not be collected. The analysis can continue, ` +
          `but the result may be less accurate.`,
      };
    }
    case "COLLECTION_TRUNCATED": {
      const ref = tableRef(first.schemaName, first.tableName);
      return {
        title: ref ? "Some details were shortened to stay within limits" : "The result was shortened to stay within limits",
        summary: ref
          ? `Some ${first.section ? SECTION_LABEL[first.section] : "details"} for ${ref} were shortened to stay ` +
            `within configured limits. Some information may be missing below.`
          : `Part of this result was shortened to stay within configured size limits. Some information may be ` +
            `missing below.`,
      };
    }
    case "DATABASE_VERSION_UNAVAILABLE":
      return {
        title: "Database version unavailable",
        summary: "The database version could not be retrieved. Version-specific analysis may be less precise.",
      };
    case "CARDINALITY_MISESTIMATE": {
      const cardinality = first.cardinality;
      const ratio = cardinality?.actualToEstimatedRatio;
      return {
        title: "Actual and estimated row counts differ materially",
        summary: ratio === undefined
          ? "Measured row counts differ materially from the optimizer estimate. Review predicate statistics as well as access paths."
          : `Measured row counts differ by ${ratio.toPrecision(3)}x from the optimizer estimate. Review predicate statistics as well as access paths.`,
      };
    }
    default:
      // Unrecognized code (a newer db-drivers than this file knows about) -
      // never drop it (§4.4): fall back to the driver's own technical message
      // verbatim rather than inventing a beginner sentence for a code this
      // file has no copy for.
      return { title: humanizeUnknownCode(code), summary: first.message };
  }
}

function humanizeUnknownCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildDiagnosticGroups(diagnostics: PerformanceTuningDiagnostic[]): PerformanceTuningDiagnosticGroupViewModel[] {
  const membersByKey = new Map<string, PerformanceTuningDiagnostic[]>();
  for (const d of diagnostics) {
    const key = groupKeyOf(d);
    const members = membersByKey.get(key) ?? [];
    members.push(d);
    membersByKey.set(key, members);
  }

  const groups: PerformanceTuningDiagnosticGroupViewModel[] = [];
  for (const [key, members] of membersByKey) {
    const { title, summary } = titleAndSummaryForDiagnosticGroup(members[0].code, members);
    groups.push({
      key: `diagnostic:${key}`,
      severity: members[0].severity,
      title,
      summary,
      // Only the first member's suggestedAction is used: within one group
      // every member shares the same code/scope/table by construction, and
      // in practice a Provider sets the same (or no) suggestedAction for
      // all of them.
      suggestedAction: members.find((m) => m.suggestedAction)?.suggestedAction,
      details: members.map(detailFromDiagnostic),
    });
  }
  return groups;
}

// UnavailableSection has no stable `code` the way PerformanceTuningDiagnostic
// does - only a stable `section` plus a free-text `reason` this file
// deliberately never parses for meaning (§4.4). `section` is still enough to
// give a real title + a generically-true impact sentence per section kind;
// `reason` (and requiredPermissions, when present) becomes the per-detail
// technical message and, when available, the suggested action - never the
// beginner-facing summary line itself (§4.4: "DBのraw error全文は通常表示へ
// 直接出さず").
function buildUnavailableSectionGroups(sections: UnavailableSection[]): PerformanceTuningDiagnosticGroupViewModel[] {
  const membersByKey = new Map<string, UnavailableSection[]>();
  for (const s of sections) {
    const key = `${s.section}:${s.schemaName ?? ""}:${s.tableName ?? ""}`;
    const members = membersByKey.get(key) ?? [];
    members.push(s);
    membersByKey.set(key, members);
  }

  const groups: PerformanceTuningDiagnosticGroupViewModel[] = [];
  for (const [key, members] of membersByKey) {
    const first = members[0];
    const ref = tableRef(first.schemaName, first.tableName);
    const permissions = members.flatMap((m) => m.requiredPermissions ?? []);
    groups.push({
      key: `unavailable:${key}`,
      severity: "warning",
      title: `${SECTION_TITLE_LABEL[first.section]} unavailable`,
      summary:
        `${SECTION_TITLE_LABEL[first.section]} could not be collected${ref ? ` for ${ref}` : ""}. ` +
        `${SECTION_IMPACT[first.section]}`,
      suggestedAction:
        permissions.length > 0
          ? `Ask your database administrator to grant: ${[...new Set(permissions)].join(", ")}.`
          : undefined,
      details: members.map((m) => ({
        schemaName: m.schemaName,
        tableName: m.tableName,
        technicalMessage: m.reason,
      })),
    });
  }
  return groups;
}

// Public entry point (implementation plan §4.4 / §10 Phase 5). Returns
// information-severity groups before warning-severity ones, and is stable
// (never reorders/drops an input entry) - see the module doc comment above
// for why grouping is code/section-specific rather than uniform.
export function buildPerformanceTuningDiagnosticGroups(
  diagnostics: PerformanceTuningDiagnostic[],
  unavailableSections: UnavailableSection[],
): PerformanceTuningDiagnosticGroupViewModel[] {
  const groups = [...buildDiagnosticGroups(diagnostics), ...buildUnavailableSectionGroups(unavailableSections)];
  return groups.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
