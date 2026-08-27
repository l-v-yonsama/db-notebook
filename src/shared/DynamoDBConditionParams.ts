export type DynamoQueryFilter = {
  name: string;
  value: string;
  operator: string;
};

// - "default": Select/ProjectionExpression both left unspecified. AWS itself
//   then returns ALL_ATTRIBUTES for a table and ALL_PROJECTED_ATTRIBUTES for
//   an index - this mode relies on that default rather than reproducing it.
// - "specific": an explicit ProjectionExpression built from
//   `projectedAttributes` (table/LSI/GSI).
// - "allTableAttributes": Select: "ALL_ATTRIBUTES" - LSI only (a GSI cannot
//   fetch non-projected base-table attributes at all).
export type DynamoQueryProjectionMode = "default" | "specific" | "allTableAttributes";
export type DynamoQueryBuildMode = "nativeQuery" | "partiql";

export type DynamoDBConditionParams = {
  target: string;
  pkValue: string;
  skValue: string;
  skOpe: string;
  limit: number;
  preview: boolean;
  sortDesc: boolean;
  filters: DynamoQueryFilter[];
  projectionMode: DynamoQueryProjectionMode;
  projectedAttributes: string[];
  consistentRead: boolean;
  // Controls only the representation built for Preview/Notebook output.
  // Execute remains a native Query so SQL History keeps Count/ScannedCount.
  buildMode: DynamoQueryBuildMode;
  openInNotebook?: boolean;
  inActiveNotebook?: boolean;
};

// Per-target Projection/Consistent Read constraints. Computed host-side from
// table/index metadata (DbDynamoTable) and sent down so the webview can
// render the right controls - the host remains the source of truth and
// re-validates everything server-side regardless of what this describes
// (DynamoQueryPanel.ts never trusts a webview-supplied mode/attribute list
// as-is).
export type DynamoQueryProjectionConstraintView = {
  // Every attribute db-notebook has ever seen for this table (same source as
  // the existing Filter column dropdown) - not a claim of DynamoDB's full
  // schema (DynamoDB is schemaless outside of keys).
  availableAttributes: string[];
  // Attributes reachable via a Query against the current target without a
  // base-table fetch. undefined when Projection metadata for the current
  // target is unknown (e.g. a custom endpoint) - Specific attributes'
  // constraints can't be enforced or displayed in that case, so "Default for
  // target" is the only mode the UI should present as unconditionally safe.
  projectedAttributes: string[] | undefined;
  // Only ever true for an LSI target.
  allowAllTableAttributesOption: boolean;
  // Only ever true for a GSI target whose Projection is known to be
  // KEYS_ONLY/INCLUDE - selecting a non-projected attribute is rejected
  // outright there, not just warned about (a GSI can never fall back to a
  // base-table fetch the way an LSI can).
  restrictToProjected: boolean;
  consistentReadAllowed: boolean;
};
