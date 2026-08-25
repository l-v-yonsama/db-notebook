import type {
  DynamoDbPerformanceTuningContext,
  DynamoDbPerformanceTuningDiagnosticCode,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type {
  DynamoDbPerformanceTuningHumanProfile,
  DynamoDbPerformanceTuningHumanSignal,
  DynamoDbPerformanceTuningHumanSummary,
} from "../shared/DynamoDbPerformanceTuningHumanSummary";

// DynamoDB counterpart of performanceTuningHumanSummary.ts. Deterministic,
// rule-based, and always cites Full Context JSON paths - same philosophy as
// the RDB builder, applied to §4's DynamoDB-specific evidence categories
// (access-path certainty, Capacity workload trend, single-read observation,
// CloudWatch throttling) instead of rows-through-plan-nodes.

const THROTTLE_DIAGNOSTIC_CODES = new Set<DynamoDbPerformanceTuningDiagnosticCode>([
  "DYNAMODB_READ_THROTTLING_OBSERVED",
  "DYNAMODB_KEY_RANGE_THROTTLING_OBSERVED",
  "DYNAMODB_PROVISIONED_THROTTLING_OBSERVED",
  "DYNAMODB_ON_DEMAND_LIMIT_THROTTLING_OBSERVED",
  "DYNAMODB_ACCOUNT_LIMIT_THROTTLING_OBSERVED",
]);

function numberText(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function percentText(value: number): string {
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function targetRef(context: DynamoDbPerformanceTuningContext): string {
  const { tableName, indexName } = context.service;
  if (!indexName) {
    return tableName;
  }
  const indexType = context.accessPattern.indexType ?? "index";
  return `${tableName} (${indexType} ${indexName})`;
}

function buildAccessPathSignal(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanSignal {
  const { accessPattern } = context;
  const target = targetRef(context);
  const filterNote = accessPattern.postReadFilter.present
    ? ` A non-key condition on ${accessPattern.postReadFilter.attributes.join(", ") || "other attributes"} is evaluated only after each item is read; Capacity already spent reading the filtered-out items is not reduced by it.`
    : "";

  switch (accessPattern.accessPath) {
    case "tableQuery":
    case "indexQuery": {
      const keyDesc = accessPattern.sortKey?.conditionPresent
        ? "a partition and sort key condition"
        : "a partition key condition";
      return {
        kind: "accessPath",
        level: "info",
        title: "Query — partition key condition present",
        summary: `This statement is guaranteed to run as a Query against ${target} (${keyDesc}).${filterNote}`,
        rawDataPath: "Full context JSON → accessPattern",
      };
    }
    case "tableScan":
    case "indexScan":
      return {
        kind: "accessPath",
        level: "attention",
        title: "Full scan — no partition key equality/IN condition",
        summary: `This statement performs a full ${accessPattern.accessPath === "tableScan" ? "table" : "index"} scan of ${target}: every item is read and charged, regardless of any non-key filter.${filterNote}`,
        rawDataPath: "Full context JSON → accessPattern",
      };
    case "unknown":
    default:
      return {
        kind: "accessPath",
        level: "unknown",
        title: "Access path could not be classified",
        summary: `This statement's key condition against ${target} could not be safely classified as a Query or a Scan. Treat the read cost as unknown until this is resolved.`,
        rawDataPath: "Full context JSON → accessPattern",
      };
  }
}

function buildCapacitySignal(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanSignal {
  const workload = context.workload;
  if (!workload || !workload.capacitySampleCount) {
    return {
      kind: "capacity",
      level: "unknown",
      title: "No Capacity history available",
      summary: "No prior execution of this exact statement has recorded Consumed Capacity yet.",
      rawDataPath: "Full context JSON → workload",
    };
  }
  const segments = [`averaged ${numberText(workload.averageCapacityUnits ?? 0)}`];
  if (workload.maxCapacityUnits !== undefined) {
    segments.push(`peaked at ${numberText(workload.maxCapacityUnits)}`);
  }
  if (workload.lastCapacityUnits !== undefined) {
    segments.push(`was ${numberText(workload.lastCapacityUnits)} most recently`);
  }
  return {
    kind: "capacity",
    level: "info",
    title: "Capacity usage history",
    summary: `Across ${workload.capacitySampleCount} prior execution(s), Consumed Capacity ${segments.join(", ")}.`,
    rawDataPath: "Full context JSON → workload",
  };
}

function buildObservationSignal(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanSignal {
  const observation = context.observation;
  if (!observation) {
    return {
      kind: "observation",
      level: "unknown",
      title: "No observed read yet",
      summary:
        "This context is based on static analysis only; no confirmed read (Run Observed Read, or a matching SQL History execution) has been recorded for this exact statement.",
      rawDataPath: "Full context JSON → observation",
    };
  }
  const parts = [`returned ${numberText(observation.returnedItemCount ?? 0)} item(s)`];
  if (observation.scannedItemCount !== undefined) {
    parts.push(`scanned ${numberText(observation.scannedItemCount)}`);
    if (observation.filterPassRate !== undefined) {
      parts.push(`a ${percentText(observation.filterPassRate)} pass rate`);
    }
  }
  const sourceLabel =
    observation.source === "observedRead"
      ? "a confirmed Run Observed Read"
      : observation.source === "sqlHistory"
        ? "a prior SQL History execution"
        : "the Dynamo Query Panel";
  const boundedNote = observation.bounded
    ? ` This observation is bounded (${observation.boundDescription ?? "a single response"}) and may not reflect the statement's full result.`
    : "";
  return {
    kind: "observation",
    level: "info",
    title: "Observed read evidence available",
    summary: `Based on ${sourceLabel}, this statement ${parts.join(", ")}.${boundedNote}`,
    rawDataPath: "Full context JSON → observation",
  };
}

function buildThrottlingSignal(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanSignal {
  const throttleDiagnostics = context.collection.diagnostics.filter((d) => THROTTLE_DIAGNOSTIC_CODES.has(d.code));
  if (throttleDiagnostics.length > 0) {
    const metricNames = [...new Set(throttleDiagnostics.map((d) => d.metricName).filter((m): m is string => !!m))];
    return {
      kind: "throttling",
      level: "attention",
      title: "Throttling observed in the CloudWatch window",
      summary: `${metricNames.length > 0 ? metricNames.join(", ") : "A throttle metric"} reported activity for ${targetRef(context)} in the CloudWatch collection window. This reflects the whole table/index/operation over that window, not only this statement.`,
      rawDataPath: "Full context JSON → cloudWatch / collection.diagnostics",
    };
  }
  const monitoringSkipped = context.collection.diagnostics.find(
    (d) => d.code === "DYNAMODB_MONITORING_COLLECTION_SKIPPED",
  );
  if (monitoringSkipped) {
    return {
      kind: "throttling",
      level: "info",
      title: "CloudWatch monitoring not collected",
      summary: monitoringSkipped.message,
      rawDataPath: "Full context JSON → collection.diagnostics",
    };
  }
  if (!context.cloudWatch) {
    return {
      kind: "throttling",
      level: "unknown",
      title: "Throttling not checked",
      summary: "CloudWatch metrics were not collected, so throttling activity is unknown.",
      rawDataPath: "Full context JSON → collection.unavailableSections",
    };
  }
  return {
    kind: "throttling",
    level: "info",
    title: "No throttling observed",
    summary: `No throttle events were reported for ${targetRef(context)} in the CloudWatch collection window (${context.cloudWatch.window.startTime} – ${context.cloudWatch.window.endTime}).`,
    rawDataPath: "Full context JSON → cloudWatch",
  };
}

function buildCollectionSignals(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanSignal[] {
  if (context.collection.status !== "partial") {
    return [];
  }
  return [
    {
      kind: "collection",
      level: "attention",
      title: "Collection is partial",
      summary: `${context.collection.unavailableSections.length} section(s) were unavailable and/or collection diagnostics affected completeness.`,
      rawDataPath: "Full context JSON → collection.unavailableSections / collection.diagnostics",
    },
  ];
}

function buildProfile(context: DynamoDbPerformanceTuningContext): DynamoDbPerformanceTuningHumanProfile {
  return {
    operation: context.accessPattern.operation,
    accessPath: context.accessPattern.accessPath,
    confidence: context.accessPattern.confidence,
    targetRef: targetRef(context),
    evidence: context.observation ? "observed" : workloadHasCapacitySamples(context) ? "workload" : "none",
    collectionStatus: context.collection.status,
  };
}

function workloadHasCapacitySamples(context: DynamoDbPerformanceTuningContext): boolean {
  return !!context.workload?.capacitySampleCount;
}

export function buildDynamoDbPerformanceTuningHumanSummary(
  context: DynamoDbPerformanceTuningContext,
): DynamoDbPerformanceTuningHumanSummary {
  return {
    profile: buildProfile(context),
    signals: [
      ...buildCollectionSignals(context),
      buildAccessPathSignal(context),
      buildCapacitySignal(context),
      buildObservationSignal(context),
      buildThrottlingSignal(context),
    ],
  };
}
