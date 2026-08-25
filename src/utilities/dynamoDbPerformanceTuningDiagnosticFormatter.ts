import type {
  DynamoDbPerformanceTuningDiagnostic,
  DynamoDbPerformanceTuningDiagnosticCode,
  DynamoDbUnavailableSection,
  DynamoDbUnavailableSectionName,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  PerformanceTuningDiagnosticDetailViewModel,
  PerformanceTuningDiagnosticGroupViewModel,
} from "../shared/MessageEventData";

// DynamoDB counterpart of performanceTuningDiagnosticFormatter.ts. Reuses the
// exact same view-model types as the RDB formatter (key/severity/title/
// summary/suggestedAction/details) - they were already engine-agnostic (no
// plan-node-only field is required), so DynamoDbPerformanceTuningView.vue can
// render both engines' diagnostic groups with the same component. Only the
// grouping/labeling logic below is DynamoDB-specific.
//
// DynamoDbPerformanceTuningDiagnostic has no plan-node identity the way
// PerformanceTuningDiagnostic does (no execution plan exists), so
// nodeId/operation on the shared detail view model are always left
// undefined here; objectName carries the index name (when present) and
// tableName carries the table name, so a detail row can show "table (index
// name)" without a dedicated field.

const SEVERITY_ORDER: Record<"info" | "warning", number> = { info: 0, warning: 1 };

// Codes that can legitimately fire more than once per collection, for
// different reasons - grouped by scope (+ indexName) so each reason gets its
// own card instead of merging into one misleading summary. Every other code
// fires at most once per collect() call today (see DynamoDbPerformanceTuningProvider.ts),
// so grouping by bare code is exact, not just a simplification.
const SCOPED_CODES = new Set<DynamoDbPerformanceTuningDiagnosticCode>([
  "DYNAMODB_SECTION_COLLECTION_FAILED",
  "DYNAMODB_COLLECTION_TRUNCATED",
]);

const SECTION_LABEL: Record<DynamoDbUnavailableSectionName, string> = {
  accessPattern: "access pattern classification",
  tableDefinition: "table definition details",
  cloudWatchMetrics: "CloudWatch metrics",
  contributorInsights: "Contributor Insights status",
  observation: "observed read evidence",
};
const SECTION_TITLE_LABEL: Record<DynamoDbUnavailableSectionName, string> = {
  accessPattern: "Access pattern",
  tableDefinition: "Table definition",
  cloudWatchMetrics: "CloudWatch metrics",
  contributorInsights: "Contributor Insights",
  observation: "Observed read",
};
const SECTION_IMPACT: Record<DynamoDbUnavailableSectionName, string> = {
  accessPattern: "The statement's Query/Scan classification is unavailable; read-cost characteristics cannot be assessed.",
  tableDefinition: "Key schema, index, and Capacity mode details are unavailable for this table.",
  cloudWatchMetrics: "Recent throughput and throttling activity are unavailable for this table/index.",
  contributorInsights: "Whether Contributor Insights is enabled is unavailable for this table/index.",
  observation: "No observed read evidence is available for this statement.",
};

const sectionTitleLabel = (scope: DynamoDbUnavailableSectionName | "collection"): string =>
  scope === "collection" ? "Some data" : SECTION_TITLE_LABEL[scope];

const sectionLabel = (scope: DynamoDbUnavailableSectionName | "collection"): string =>
  scope === "collection" ? "data" : SECTION_LABEL[scope];

const targetRef = (tableName: string | undefined, indexName: string | undefined): string | undefined =>
  tableName ? (indexName ? `${tableName} (${indexName})` : tableName) : indexName;

const detailFromDiagnostic = (d: DynamoDbPerformanceTuningDiagnostic): PerformanceTuningDiagnosticDetailViewModel => ({
  tableName: d.tableName,
  objectName: d.indexName,
  // Always non-empty, same guarantee as the RDB type - see that field's
  // comment in DynamoDbPerformanceTuningDiagnostic.ts.
  technicalMessage: d.message,
});

function groupKeyOf(d: DynamoDbPerformanceTuningDiagnostic): string {
  if (SCOPED_CODES.has(d.code)) {
    return `${d.code}:${d.scope}:${d.indexName ?? ""}`;
  }
  return d.code;
}

function titleAndSummaryForDiagnosticGroup(
  code: DynamoDbPerformanceTuningDiagnosticCode | string,
  members: DynamoDbPerformanceTuningDiagnostic[],
): { title: string; summary: string } {
  const first = members[0];

  switch (code) {
    case "DYNAMODB_FULL_TABLE_SCAN":
      return {
        title: "Full table scan",
        summary:
          "This statement performs a full table scan: every item in the table is read and charged, regardless of any non-key filter.",
      };
    case "DYNAMODB_FULL_INDEX_SCAN":
      return {
        title: "Full index scan",
        summary:
          "This statement performs a full index scan: every item in the index is read and charged, regardless of any non-key filter.",
      };
    case "DYNAMODB_POST_READ_FILTER":
      return {
        title: "Post-read filter",
        summary:
          "A non-key condition is evaluated only after each item is read. Capacity already spent reading the filtered-out items is not reduced by this filter.",
      };
    case "DYNAMODB_ACCESS_PATTERN_UNRESOLVED":
      return {
        title: "Access path could not be classified",
        summary: "The statement could not be safely classified as a Query or a Scan. Treat the read cost as unknown.",
      };
    case "DYNAMODB_HIGH_SCANNED_TO_RETURNED":
      return {
        title: "Large fraction of scanned items filtered out",
        summary:
          "A large fraction of the items scanned by this observed read were filtered out afterward. Capacity is spent on scanned items regardless of whether they were returned.",
      };
    case "DYNAMODB_READ_THROTTLING_OBSERVED":
      return {
        title: "Read throttling observed",
        summary:
          "CloudWatch reported ReadThrottleEvents in the collection window. This reflects the whole table/index/operation over that window, not only this statement.",
      };
    case "DYNAMODB_KEY_RANGE_THROTTLING_OBSERVED":
      return {
        title: "Hot partition throttling observed",
        summary:
          "CloudWatch reported ReadKeyRangeThroughputThrottleEvents, the hot-partition throttle signal, in the collection window. This does not by itself identify which partition key value is hot - corroborate with Contributor Insights before concluding a specific key is hot.",
      };
    case "DYNAMODB_PROVISIONED_THROTTLING_OBSERVED":
      return {
        title: "Provisioned throughput throttling observed",
        summary: "CloudWatch reported provisioned read throughput throttling in the collection window.",
      };
    case "DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED":
      return {
        title: "On-demand limit throttling observed",
        summary: "CloudWatch reported on-demand max throughput throttling in the collection window.",
      };
    case "DYNAMODB_ACCOUNT_LIMIT_THROTTLING_OBSERVED":
      return {
        title: "Account limit throttling observed",
        summary: "CloudWatch reported account-level throughput limit throttling in the collection window.",
      };
    case "DYNAMODB_OBSERVATION_BOUNDED":
      return { title: "Observation was bounded", summary: first.message };
    case "DYNAMODB_APPROXIMATE_TABLE_METADATA":
      return {
        title: "Table metadata is approximate",
        summary:
          "ItemCount and TableSizeBytes are AWS-reported approximations, updated roughly every six hours. Do not treat them as an exact count.",
      };
    case "DYNAMODB_CLOUDWATCH_NO_DATA": {
      const metricNames = [...new Set(members.map((m) => m.metricName).filter((m): m is string => !!m))];
      return {
        title: "No CloudWatch datapoints",
        summary: `No datapoints were returned for ${metricNames.length > 0 ? metricNames.join(", ") : "one or more metrics"} in the collection window. This is not the same fact as zero activity.`,
      };
    }
    case "DYNAMODB_MONITORING_COLLECTION_SKIPPED":
      return {
        title: "CloudWatch monitoring not collected",
        summary: first.message,
      };
    case "DYNAMODB_SECTION_COLLECTION_FAILED": {
      const scope = first.scope;
      return {
        title: `${sectionTitleLabel(scope)} could not be fully collected`,
        summary: `Some ${sectionLabel(scope)} could not be collected. The analysis can continue, but the result may be less accurate.`,
      };
    }
    case "DYNAMODB_COLLECTION_TRUNCATED":
      return first.scope === "tableDefinition"
        ? {
            title: "Index list shortened to stay within limits",
            summary:
              "The table/index list was shortened to stay within the configured index-count limit. Some indexes may be missing below.",
          }
        : {
            title: "Result shortened to stay within limits",
            summary:
              "Part of this context was shortened to stay within the configured payload size limit. Some information may be missing below.",
          };
    default:
      // Unrecognized code (a newer db-drivers than this file knows about) -
      // never drop it, same rule as the RDB formatter: fall back to the
      // driver's own technical message verbatim.
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

function buildDiagnosticGroups(
  diagnostics: DynamoDbPerformanceTuningDiagnostic[],
): PerformanceTuningDiagnosticGroupViewModel[] {
  const membersByKey = new Map<string, DynamoDbPerformanceTuningDiagnostic[]>();
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
      // Unlike RDB's PerformanceTuningDiagnostic, DynamoDbPerformanceTuningDiagnostic
      // has no suggestedAction field at all - the only source of one here is
      // requiredPermissions on an UnavailableSection (see
      // buildUnavailableSectionGroups() below).
      details: members.map(detailFromDiagnostic),
    });
  }
  return groups;
}

// DynamoDbUnavailableSection has no stable per-code identity the way
// DynamoDbPerformanceTuningDiagnostic does - only a stable `section` plus a
// free-text `reason` this file deliberately never parses for meaning (same
// rule as the RDB formatter). `section` (+ indexName) is still enough to
// give a real title, a generically-true impact sentence, and - when present -
// a suggested action from requiredPermissions.
function buildUnavailableSectionGroups(
  sections: DynamoDbUnavailableSection[],
): PerformanceTuningDiagnosticGroupViewModel[] {
  const membersByKey = new Map<string, DynamoDbUnavailableSection[]>();
  for (const s of sections) {
    const key = `${s.section}:${s.tableName ?? ""}:${s.indexName ?? ""}`;
    const members = membersByKey.get(key) ?? [];
    members.push(s);
    membersByKey.set(key, members);
  }

  const groups: PerformanceTuningDiagnosticGroupViewModel[] = [];
  for (const [key, members] of membersByKey) {
    const first = members[0];
    const ref = targetRef(first.tableName, first.indexName);
    const permissions = members.flatMap((m) => m.requiredPermissions ?? []);
    groups.push({
      key: `unavailable:${key}`,
      severity: "warning",
      title: `${SECTION_TITLE_LABEL[first.section]} unavailable`,
      summary: `${SECTION_TITLE_LABEL[first.section]} could not be collected${ref ? ` for ${ref}` : ""}. ${SECTION_IMPACT[first.section]}`,
      suggestedAction:
        permissions.length > 0
          ? `Ask your AWS administrator to grant: ${[...new Set(permissions)].join(", ")}.`
          : undefined,
      details: members.map((m) => ({
        tableName: m.tableName,
        objectName: m.indexName,
        technicalMessage: m.reason,
      })),
    });
  }
  return groups;
}

// Public entry point, mirroring buildPerformanceTuningDiagnosticGroups()'s
// contract exactly (information-severity first, stable, never drops an
// input entry).
export function buildDynamoDbPerformanceTuningDiagnosticGroups(
  diagnostics: DynamoDbPerformanceTuningDiagnostic[],
  unavailableSections: DynamoDbUnavailableSection[],
): PerformanceTuningDiagnosticGroupViewModel[] {
  const groups = [...buildDiagnosticGroups(diagnostics), ...buildUnavailableSectionGroups(unavailableSections)];
  return groups.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
