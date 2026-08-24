// DynamoDB counterpart of PerformanceTuningHumanSummary.ts. Deliberately a
// separate, differently-shaped type rather than a union member of the RDB
// one - the two engines' "what determines performance" concepts do not line
// up field-for-field (no rows-through-plan-nodes concept here; DynamoDB's
// nearest equivalents are access-path certainty, Capacity workload, and
// observed-read/CloudWatch evidence - see the design doc's §4 comparison
// table). Section 5 ("Access pattern") of DynamoDbPerformanceTuningView.vue
// renders the detailed key-condition breakdown separately, built by
// dynamoDbPerformanceTuningAccessPatternFormatter.ts - this type is only the
// coarse, decision-relevant "snapshot" (§11.3 item 3), not a duplicate of it.

export type DynamoDbPerformanceTuningHumanSignal = {
  kind: "accessPath" | "capacity" | "observation" | "throttling" | "collection";
  level: "info" | "attention" | "unknown";
  title: string;
  summary: string;
  rawDataPath: string;
};

export type DynamoDbPerformanceTuningHumanProfile = {
  operation: "PartiQLSelect" | "Query" | "Scan";
  accessPath: "tableQuery" | "indexQuery" | "tableScan" | "indexScan" | "unknown";
  confidence: "certain" | "unknown";
  // "orders" or "orders (GSI iCountry)" - already includes the index, so the
  // webview can show it as a single line.
  targetRef: string;
  // What kind of read evidence (if any) backs this Context - a single
  // confirmed Run Observed Read/SQL-History observation ("observed"), only a
  // rolling multi-execution Capacity/timing trend ("workload"), or neither
  // ("none" - static access-path classification only).
  evidence: "observed" | "workload" | "none";
  collectionStatus: "complete" | "partial";
};

export type DynamoDbPerformanceTuningHumanSummary = {
  profile: DynamoDbPerformanceTuningHumanProfile;
  signals: DynamoDbPerformanceTuningHumanSignal[];
};
