import { DbDynamoTable } from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  DynamoQueryProjectionConstraintView,
  DynamoQueryProjectionMode,
} from "../shared/DynamoDBConditionParams";

// See misc/specs/dynamodb-query-panel-history-performance-implementation-plan.ja.md
// §6.1/§6.2/§6.5. Host-only (imports DbDynamoTable from db-drivers) - the
// webview-safe constraint *shape* lives in shared/DynamoDBConditionParams.ts
// instead, since webview-ui re-exports src/shared/* directly into its own
// bundle and can't depend on a Node-only db-drivers import.

// Computes what Projection/Consistent Read choices are actually valid for
// `target` (a DynamoQueryPanel target string: "$table", "$lsi:<name>", or
// "$gsi:<name>") against `tableRes`'s known metadata.
export function computeDynamoProjectionConstraint(
  tableRes: DbDynamoTable,
  target: string
): DynamoQueryProjectionConstraintView {
  const availableAttributes = tableRes.children.map((it) => it.name);

  if (target === "$table") {
    return {
      availableAttributes,
      projectedAttributes: availableAttributes,
      allowAllTableAttributesOption: false,
      restrictToProjected: false,
      consistentReadAllowed: true,
    };
  }

  const isLsi = target.startsWith("$lsi:");
  const isGsi = target.startsWith("$gsi:");
  if (!isLsi && !isGsi) {
    // Unrecognized target - be as conservative as the "metadata unknown"
    // case below.
    return {
      availableAttributes,
      projectedAttributes: undefined,
      allowAllTableAttributesOption: false,
      restrictToProjected: false,
      consistentReadAllowed: false,
    };
  }

  const indexName = target.slice(5);
  const index = isLsi
    ? tableRes.attr.lsi?.find((it) => it.IndexName === indexName)
    : tableRes.attr.gsi?.find((it) => it.IndexName === indexName);

  if (!index) {
    return {
      availableAttributes,
      projectedAttributes: undefined,
      allowAllTableAttributesOption: isLsi,
      restrictToProjected: false,
      consistentReadAllowed: isLsi,
    };
  }

  const keyAttrs = (index.KeySchema ?? [])
    .map((k) => k.AttributeName)
    .filter((n): n is string => !!n);
  const tableKeyAttrs = tableRes.children.filter((it) => it.pk || it.sk).map((it) => it.name);
  const projectionType = index.Projection?.ProjectionType;

  let projectedAttributes: string[] | undefined;
  if (projectionType === "ALL") {
    projectedAttributes = availableAttributes;
  } else if (projectionType === "KEYS_ONLY") {
    projectedAttributes = [...new Set([...keyAttrs, ...tableKeyAttrs])];
  } else if (projectionType === "INCLUDE") {
    projectedAttributes = [
      ...new Set([...keyAttrs, ...tableKeyAttrs, ...(index.Projection?.NonKeyAttributes ?? [])]),
    ];
  } else {
    // Projection metadata unknown (e.g. a custom endpoint that didn't report
    // it) - Specific attributes' constraints can't be enforced, so this
    // stays undefined rather than guessing ALL or KEYS_ONLY.
    projectedAttributes = undefined;
  }

  return {
    availableAttributes,
    projectedAttributes,
    // An LSI can always fall back to a base-table fetch (at a latency/
    // Capacity cost - see selectionNeedsBaseTableFetch below); a GSI never
    // can. ProjectionType ALL already includes every attribute, so there is
    // nothing left to restrict even though projectedAttributes is defined.
    allowAllTableAttributesOption: isLsi,
    restrictToProjected: isGsi && (projectionType === "KEYS_ONLY" || projectionType === "INCLUDE"),
    consistentReadAllowed: isLsi,
  };
}

// Re-derives a valid (mode, attributes) pair from whatever the webview sent,
// never trusting it as-is (design doc §6.5: "webview から送られた...をその
// まま信頼しない"). Also used to normalize the host's own retained state
// after a target switch.
export function resolveDynamoProjectionSelection(params: {
  mode: DynamoQueryProjectionMode;
  attributes: string[];
  constraint: DynamoQueryProjectionConstraintView;
}): { mode: DynamoQueryProjectionMode; attributes: string[] } {
  const { constraint } = params;
  let mode = params.mode;
  // De-duplicates (design doc §6.1's "重複属性は host 側でも拒否する") and
  // drops empty entries.
  let attributes = [...new Set(params.attributes.filter((a) => a.length > 0))];

  if (mode === "allTableAttributes" && !constraint.allowAllTableAttributesOption) {
    mode = "default";
  }
  if (mode === "specific") {
    if (constraint.restrictToProjected && constraint.projectedAttributes) {
      const allowed = new Set(constraint.projectedAttributes);
      attributes = attributes.filter((a) => allowed.has(a));
    }
    // Keep an empty Specific selection as an editing/validation state. The
    // UI must stay in this mode so the user can choose the first attribute.
  } else {
    attributes = [];
  }
  return { mode, attributes };
}

// A GSI can never use strongly consistent reads - force it off regardless of
// what was requested (design doc §6.2), independent of the webview's own
// disabled-checkbox behavior.
export function resolveDynamoConsistentRead(
  consistentRead: boolean,
  constraint: DynamoQueryProjectionConstraintView
): boolean {
  return constraint.consistentReadAllowed ? consistentRead : false;
}

// AWS Query API leaves Select/ProjectionExpression unspecified => table:
// ALL_ATTRIBUTES, index: ALL_PROJECTED_ATTRIBUTES (design doc §6.1) - the
// "default" mode below relies on that AWS-side default rather than
// reproducing it, so it never sets either field.
export function buildDynamoProjectionExpression(
  mode: DynamoQueryProjectionMode,
  attributes: string[]
): {
  select?: "ALL_ATTRIBUTES";
  projectionExpression?: string;
  expressionAttributeNames: Record<string, string>;
} {
  if (mode === "allTableAttributes") {
    return { select: "ALL_ATTRIBUTES", expressionAttributeNames: {} };
  }
  if (mode === "specific" && attributes.length > 0) {
    // Always aliased via ExpressionAttributeNames, regardless of whether the
    // attribute name is a reserved word or contains whitespace/symbols
    // (design doc §6.1's "予約語、空白、記号を含む属性名を利用者入力のまま
    // expression に埋め込まない") - never interpolated into the expression
    // text directly.
    const expressionAttributeNames: Record<string, string> = {};
    const aliases = attributes.map((name, idx) => {
      const alias = `#p${idx}`;
      expressionAttributeNames[alias] = name;
      return alias;
    });
    return { projectionExpression: aliases.join(", "), expressionAttributeNames };
  }
  return { expressionAttributeNames: {} };
}

// LSI-only advisory (design doc §6.1/§14): true when the resolved selection
// includes an attribute the target's own Projection wouldn't return, meaning
// a base-table fetch (extra latency/Capacity) may occur. Always false for a
// GSI (restrictToProjected already filtered those out upstream) and for the
// `default` mode, which has no discrete attribute list to check.
export function selectionNeedsBaseTableFetch(
  mode: DynamoQueryProjectionMode,
  attributes: string[],
  constraint: DynamoQueryProjectionConstraintView
): boolean {
  if (!constraint.projectedAttributes) {
    return false;
  }
  if (mode === "allTableAttributes") {
    return constraint.allowAllTableAttributesOption &&
      constraint.projectedAttributes.length < constraint.availableAttributes.length;
  }
  if (mode !== "specific") {
    return false;
  }
  const projected = new Set(constraint.projectedAttributes);
  return attributes.some((a) => !projected.has(a));
}
