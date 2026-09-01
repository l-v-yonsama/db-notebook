import type {
  DynamoDbQueryAnalysisInput,
  QueryItemsAtClientInputParams,
} from "@l-v-yonsama/multi-platform-database-drivers";

// QueryItemsAtClientInputParams *is* the AWS SDK's QueryCommandInput (a bare
// type alias - see AwsDynamoServiceClient.ts), so it's the type db-notebook
// already has on hand everywhere a real, value-ful native Query request
// exists (DynamoQueryPanel.ts's own `queryInput` field). This file only
// strips it down to DynamoDbQueryAnalysisInput - the values-free structural
// mirror DynamoDbPerformanceTuningContextParams' static collection path
// requires (never ExpressionAttributeValues/ExclusiveStartKey) - kept as a
// small leaf utility with no dependency on either
// dynamoDbPerformanceTuningPreview.ts or PerformanceTuningPreviewPanel.ts,
// since both of those need to import this and already import each other
// (type-only) to avoid a runtime circular import between themselves.
export function toDynamoDbQueryAnalysisInput(input: QueryItemsAtClientInputParams): DynamoDbQueryAnalysisInput {
  if (!input.TableName || !input.KeyConditionExpression) {
    throw new Error("A native Query analysis input requires TableName and KeyConditionExpression.");
  }
  return {
    tableName: input.TableName,
    indexName: input.IndexName,
    keyConditionExpression: input.KeyConditionExpression,
    filterExpression: input.FilterExpression,
    projectionExpression: input.ProjectionExpression,
    select: input.Select,
    expressionAttributeNames: input.ExpressionAttributeNames,
    consistentRead: input.ConsistentRead,
    scanIndexForward: input.ScanIndexForward,
    // queryItemsAtClient treats Limit as the cap on items retained across
    // its pagination loop, not as a raw per-request Query API Limit.
    resultItemLimit: input.Limit,
  };
}
