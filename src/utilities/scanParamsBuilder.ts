import {
  AwsCloudWatchLogGroupScanParams,
  AwsCloudWatchLogStreamScanParams,
  AwsS3ScanParams,
  AwsSQSScanParams,
  Auth0ScanParams,
  KeycloakScanParams,
  MemcacheScanParams,
  MqttScanParams,
  RedisScanParams,
} from "@l-v-yonsama/multi-platform-database-drivers";

export function buildRedisScanParams(params: {
  dbIndex: string | number;
  keyGlob?: string;
  limit: number;
  fetchValueLimitSize?: number;
}): RedisScanParams {
  const dbIndex = Number(params.dbIndex);
  return {
    kind: "redis",
    dbIndex: Number.isNaN(dbIndex) ? 0 : dbIndex,
    keyGlob: params.keyGlob,
    limit: params.limit,
    fetchValue: params.fetchValueLimitSize ? { limitSize: params.fetchValueLimitSize } : undefined,
  };
}

export function buildMemcacheScanParams(params: {
  key: string;
  matchType: "exact" | "partial";
  limit: number;
}): MemcacheScanParams {
  return {
    kind: "memcache",
    key: params.key,
    matchType: params.matchType,
    limit: params.limit,
  };
}

export function buildMqttScanParams(params: {
  topicFilter?: string;
  matchType?: "exact" | "partial";
  payloadContains?: string;
  limit: number;
  startTime?: number;
  endTime?: number;
  jsonExpansion?: boolean;
  fetchValueLimitSize?: number;
}): MqttScanParams {
  return {
    kind: "mqtt",
    topicFilter: params.topicFilter,
    matchType: params.matchType,
    payloadContains: params.payloadContains,
    limit: params.limit,
    startTime: params.startTime,
    endTime: params.endTime,
    jsonExpansion: params.jsonExpansion,
    fetchValue: params.fetchValueLimitSize ? { limitSize: params.fetchValueLimitSize } : undefined,
  };
}

export function buildAwsS3ScanParams(params: {
  bucketName: string;
  keyPrefix?: string;
  lastModifiedAfter?: number;
  lastModifiedBefore?: number;
  limit: number;
  fetchValueLimitSize?: number;
}): AwsS3ScanParams {
  return {
    kind: "aws-s3",
    bucketName: params.bucketName,
    keyPrefix: params.keyPrefix,
    lastModifiedAfter: params.lastModifiedAfter,
    lastModifiedBefore: params.lastModifiedBefore,
    limit: params.limit,
    fetchValue: params.fetchValueLimitSize ? { limitSize: params.fetchValueLimitSize } : undefined,
  };
}

export function buildAwsSQSScanParams(params: {
  queueUrl: string;
  bodyOrMessageIdContains?: string;
  limit: number;
}): AwsSQSScanParams {
  return {
    kind: "aws-sqs",
    queueUrl: params.queueUrl,
    bodyOrMessageIdContains: params.bodyOrMessageIdContains,
    limit: params.limit,
  };
}

export function buildAwsCloudWatchLogGroupScanParams(params: {
  logGroupName: string;
  insightsQuery?: string;
  startTime?: number;
  endTime?: number;
  limit: number;
}): AwsCloudWatchLogGroupScanParams {
  return {
    kind: "aws-cloudwatch-loggroup",
    logGroupName: params.logGroupName,
    insightsQuery: params.insightsQuery,
    startTime: params.startTime,
    endTime: params.endTime,
    limit: params.limit,
  };
}

export function buildAwsCloudWatchLogStreamScanParams(params: {
  logGroupName: string;
  logStreamName: string;
  startTime?: number;
  limit: number;
}): AwsCloudWatchLogStreamScanParams {
  return {
    kind: "aws-cloudwatch-logstream",
    logGroupName: params.logGroupName,
    logStreamName: params.logStreamName,
    startTime: params.startTime,
    limit: params.limit,
  };
}

export function buildKeycloakScanParams(params: {
  resourceType: KeycloakScanParams["resourceType"];
  realmName?: string;
  parentId?: string;
  searchQuery?: string;
  limit: number;
  jsonExpansion?: boolean;
}): KeycloakScanParams {
  return {
    kind: "keycloak",
    resourceType: params.resourceType,
    realmName: params.realmName,
    parentId: params.parentId,
    searchQuery: params.searchQuery,
    limit: params.limit,
    jsonExpansion: params.jsonExpansion,
  };
}

export function buildAuth0ScanParams(params: {
  resourceType: Auth0ScanParams["resourceType"];
  parentId?: string;
  searchQuery?: string;
  limit: number;
  jsonExpansion?: boolean;
}): Auth0ScanParams {
  return {
    kind: "auth0",
    resourceType: params.resourceType,
    parentId: params.parentId,
    searchQuery: params.searchQuery,
    limit: params.limit,
    jsonExpansion: params.jsonExpansion,
  };
}
