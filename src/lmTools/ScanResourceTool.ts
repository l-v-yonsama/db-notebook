import {
  Auth0Driver,
  AwsCloudwatchServiceClient,
  AwsDriver,
  AwsS3ServiceClient,
  AwsSQSServiceClient,
  BaseDriver,
  DBType,
  KeycloakDriver,
  MemcacheDriver,
  RedisDriver,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData } from "@l-v-yonsama/rdh";
import dayjs from "dayjs";
import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { MqttDriverManager } from "../mqtt/MqttDriverManager";
import { getDatabaseConfig } from "../utilities/configUtil";
import { workflow } from "../utilities/driverResolver";
import { log } from "../utilities/logger";
import {
  buildAuth0ScanParams,
  buildAwsCloudWatchLogGroupScanParams,
  buildAwsCloudWatchLogStreamScanParams,
  buildAwsS3ScanParams,
  buildAwsSQSScanParams,
  buildKeycloakScanParams,
  buildMemcacheScanParams,
  buildMqttScanParams,
  buildRedisScanParams,
} from "../utilities/scanParamsBuilder";
import { StateStorage } from "../utilities/StateStorage";
import { resolveMcpEnabledConnection } from "./mcpAccessControl";
import { formatRdhForModel } from "./resultFormatter";

const PREFIX = "[lmTools/ScanResourceTool]";

// Keep individual scanned values small enough for the model's context window
// (the human-facing ScanPanel UI uses a much larger 100_000 limit).
const DEFAULT_SCAN_VALUE_LIMIT_SIZE = 2_000;

/**
 * Exactly one of these keys must be set on `ScanResourceToolInput`. Each key maps 1:1 to a
 * `ScanParams` variant `kind` in db-drivers, and its nested object's fields mirror that
 * variant's own field names -- unlike the old flat input, no field here means something
 * different depending on which connection type it's used with.
 */
const SCAN_KINDS = [
  "redis",
  "memcache",
  "mqtt",
  "awsS3",
  "awsSqs",
  "awsCloudWatchLogGroup",
  "awsCloudWatchLogStream",
  "keycloak",
  "auth0",
] as const;
type ScanKind = (typeof SCAN_KINDS)[number];

const KIND_DBTYPE: Record<ScanKind, DBType> = {
  redis: DBType.Redis,
  memcache: DBType.Memcache,
  mqtt: DBType.Mqtt,
  keycloak: DBType.Keycloak,
  auth0: DBType.Auth0,
  awsS3: DBType.Aws,
  awsSqs: DBType.Aws,
  awsCloudWatchLogGroup: DBType.Aws,
  awsCloudWatchLogStream: DBType.Aws,
};

export type ScanResourceToolInput = {
  connectionName: string;
  /** Maximum number of results to return. Defaults to the configured default query row limit. */
  limit?: number;

  redis?: {
    /** DB index to scan. Defaults to 0. */
    dbIndex?: number;
    /** `SCAN MATCH` glob pattern applied to key names (e.g. "session:*"). Defaults to all keys. */
    keyGlob?: string;
    /** Byte size cap for including a matched key's value in the result. */
    fetchValueLimitSize?: number;
  };
  memcache?: {
    /** The key name. */
    key: string;
    /** 'exact': key must equal a key name exactly. 'partial': key is matched as a substring. */
    matchType: "exact" | "partial";
  };
  mqtt?: {
    /** Subscription topic filter to scan. Empty/omitted scans across all subscribed topics. */
    topicFilter?: string;
    /** 'exact': topicFilter must equal a subscription exactly. 'partial' (default): wildcard/substring match. */
    matchType?: "exact" | "partial";
    /** Substring match against the message payload text. */
    payloadContains?: string;
    /** Optional ISO 8601 start of a message-timestamp range filter. */
    startTime?: string;
    /** Optional ISO 8601 end of a message-timestamp range filter. */
    endTime?: string;
    /** Expand nested JSON payloads into individual columns. Only applied when a single topic matched. */
    jsonExpansion?: boolean;
    /** Byte size cap for including a message's payload in the result. */
    fetchValueLimitSize?: number;
  };
  awsS3?: {
    /** The S3 bucket name. Call getDbSchema first to find exact bucket names. */
    bucketName: string;
    /** Object key prefix filter. */
    keyPrefix?: string;
    /** Optional ISO 8601 start of a LastModified range filter. */
    lastModifiedAfter?: string;
    /** Optional ISO 8601 end of a LastModified range filter. */
    lastModifiedBefore?: string;
    /** Byte size cap for including an object's body in the result. */
    fetchValueLimitSize?: number;
  };
  awsSqs?: {
    /** The SQS queue URL. Call getDbSchema first to find exact queue URLs. */
    queueUrl: string;
    /** Substring match against the message body or messageId. */
    bodyOrMessageIdContains?: string;
  };
  awsCloudWatchLogGroup?: {
    /** The CloudWatch log group name. Call getDbSchema first to find exact log group names. */
    logGroupName: string;
    /** A CloudWatch Logs Insights query string. */
    insightsQuery?: string;
    /** Optional ISO 8601 start of the query's time range. */
    startTime?: string;
    /** Optional ISO 8601 end of the query's time range. */
    endTime?: string;
  };
  awsCloudWatchLogStream?: {
    /** The parent log group's name. */
    logGroupName: string;
    /** The log stream name. Call getDbSchema first to find exact log stream names. */
    logStreamName: string;
    /** Optional ISO 8601 start of a timestamp range filter (there is no end bound). */
    startTime?: string;
  };
  keycloak?: {
    /** Which kind of Keycloak resource to list. */
    resourceType: "IamRealm" | "IamGroup" | "IamRole" | "IamUser" | "IamSession";
    /** Realm name. Required except for resourceType "IamRealm". */
    realmName?: string;
    /** Client or group id to scope results to. Only used by "IamSession". */
    parentId?: string;
    /** Free-text search, passed through to Keycloak's own search param. */
    searchQuery?: string;
    /** Expand the nested `attributes` object into individual columns. Only used by "IamUser". */
    jsonExpansion?: boolean;
  };
  auth0?: {
    /** Which kind of Auth0 resource to list. */
    resourceType: "IamClient" | "IamUser" | "IamRole" | "IamOrganization";
    /** Organization id to scope results to its members. Only used by "IamUser". */
    parentId?: string;
    /** Free-text search, passed through to the Auth0 Management API. */
    searchQuery?: string;
    /** Expand nested metadata objects into individual columns. */
    jsonExpansion?: boolean;
  };
};

type ScanRunResult = {
  ok: boolean;
  message: string;
  rdh?: ResultSetData;
  availableConnectionNames?: string[];
};

export class ScanResourceTool implements LanguageModelTool<ScanResourceToolInput> {
  constructor(private readonly stateStorage: StateStorage) {}

  async invoke(
    options: LanguageModelToolInvocationOptions<ScanResourceToolInput>,
    _token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const input = options.input;
    log(`${PREFIX} invoked connectionName:[${input.connectionName}] kind:[${resolveScanKind(input).kind ?? ""}]`);
    try {
      const result = await scanResource(this.stateStorage, input);
      if (!result.ok || !result.rdh) {
        const lines = [`❌ ${result.message}`];
        if (result.availableConnectionNames?.length) {
          lines.push(`Available connections: ${result.availableConnectionNames.join(", ")}`);
        }
        log(`${PREFIX} result:[${lines.join(" ")}]`);
        return new LanguageModelToolResult([new LanguageModelTextPart(lines.join("\n"))]);
      }
      const text = formatRdhForModel(result.rdh, getDatabaseConfig().limitRows);
      log(`${PREFIX} result: ${result.rdh.rows.length} row(s) returned`);
      return new LanguageModelToolResult([new LanguageModelTextPart(text)]);
    } catch (e: any) {
      const message = `❌ Failed to scan "${input.connectionName}": ${e?.message ?? e}`;
      log(`${PREFIX} result:[${message}]`);
      return new LanguageModelToolResult([new LanguageModelTextPart(message)]);
    }
  }
}

function toEpochSeconds(dt?: string): number | undefined {
  return dt ? Math.round(dayjs(dt).valueOf() / 1000) : undefined;
}

function resolveScanKind(
  input: ScanResourceToolInput
): { ok: true; kind: ScanKind } | { ok: false; kind?: undefined; message: string } {
  const present = SCAN_KINDS.filter((k) => input[k] !== undefined);
  if (present.length === 0) {
    return { ok: false, message: `Specify scan parameters under exactly one of: ${SCAN_KINDS.join(", ")}.` };
  }
  if (present.length > 1) {
    return {
      ok: false,
      message: `Specify scan parameters under only one of: ${present.join(", ")} (got ${present.length}).`,
    };
  }
  return { ok: true, kind: present[0] };
}

async function scanResource(
  stateStorage: StateStorage,
  input: ScanResourceToolInput
): Promise<ScanRunResult> {
  const resolution = await resolveMcpEnabledConnection(stateStorage, input.connectionName);
  if (!resolution.ok) {
    return { ok: false, message: resolution.message, availableConnectionNames: resolution.availableConnectionNames };
  }
  const setting = resolution.setting;

  const resolvedKind = resolveScanKind(input);
  if (!resolvedKind.ok) {
    return { ok: false, message: resolvedKind.message };
  }
  const kind = resolvedKind.kind;

  const expectedDbType = KIND_DBTYPE[kind];
  if (setting.dbType !== expectedDbType) {
    return {
      ok: false,
      message: `Connection "${input.connectionName}" is a ${setting.dbType} connection; "${kind}" scan parameters require a ${expectedDbType} connection.`,
    };
  }

  const limit = input.limit ?? getDatabaseConfig().limitRows;

  // Mqtt scan() reads from an in-memory buffer that only exists on the persistent,
  // already-connected driver managed by MqttDriverManager (the resource tree's
  // "Connect"/subscribe flow) -- workflow() below creates a fresh short-lived driver
  // per call for every other dbType, which would have no subscriptions and always
  // return empty results for Mqtt.
  if (kind === "mqtt") {
    const manager = MqttDriverManager.getInstance(setting);
    if (!manager.isConnected()) {
      return {
        ok: false,
        message: `Connection "${input.connectionName}" is not connected. Connect and subscribe to the relevant topics via the MQTT panel before scanning.`,
      };
    }
    const p = input.mqtt!;
    const rdh = await manager.scan(
      buildMqttScanParams({
        topicFilter: p.topicFilter,
        matchType: p.matchType,
        payloadContains: p.payloadContains,
        limit,
        startTime: toEpochSeconds(p.startTime),
        endTime: toEpochSeconds(p.endTime),
        jsonExpansion: p.jsonExpansion,
        fetchValueLimitSize: p.fetchValueLimitSize ?? DEFAULT_SCAN_VALUE_LIMIT_SIZE,
      })
    );
    return { ok: true, message: "", rdh };
  }

  const result = await workflow<BaseDriver, ResultSetData>(
    setting,
    async (driver): Promise<ResultSetData> => {
      switch (kind) {
        case "redis": {
          if (!(driver instanceof RedisDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not a Redis connection.`);
          }
          const p = input.redis!;
          return await driver.scan(
            buildRedisScanParams({
              dbIndex: p.dbIndex ?? 0,
              keyGlob: p.keyGlob,
              limit,
              fetchValueLimitSize: p.fetchValueLimitSize ?? DEFAULT_SCAN_VALUE_LIMIT_SIZE,
            })
          );
        }
        case "memcache": {
          if (!(driver instanceof MemcacheDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not a Memcache connection.`);
          }
          const p = input.memcache!;
          return await driver.scan(
            buildMemcacheScanParams({
              key: p.key,
              matchType: p.matchType,
              limit,
            })
          );
        }
        case "keycloak": {
          if (!(driver instanceof KeycloakDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not a Keycloak connection.`);
          }
          const p = input.keycloak!;
          return await driver.scan(
            buildKeycloakScanParams({
              resourceType: p.resourceType,
              realmName: p.realmName,
              parentId: p.parentId,
              searchQuery: p.searchQuery,
              limit,
              jsonExpansion: p.jsonExpansion,
            })
          );
        }
        case "auth0": {
          if (!(driver instanceof Auth0Driver)) {
            throw new Error(`Connection "${input.connectionName}" is not an Auth0 connection.`);
          }
          const p = input.auth0!;
          return await driver.scan(
            buildAuth0ScanParams({
              resourceType: p.resourceType,
              parentId: p.parentId,
              searchQuery: p.searchQuery,
              limit,
              jsonExpansion: p.jsonExpansion,
            })
          );
        }
        case "awsS3": {
          if (!(driver instanceof AwsDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not an AWS connection.`);
          }
          const client = driver.getClientByResourceType<AwsS3ServiceClient>(ResourceType.Bucket);
          if (!client) {
            throw new Error("S3 is not configured for this connection.");
          }
          const p = input.awsS3!;
          return await client.scan(
            buildAwsS3ScanParams({
              bucketName: p.bucketName,
              keyPrefix: p.keyPrefix,
              lastModifiedAfter: toEpochSeconds(p.lastModifiedAfter),
              lastModifiedBefore: toEpochSeconds(p.lastModifiedBefore),
              limit,
              fetchValueLimitSize: p.fetchValueLimitSize ?? DEFAULT_SCAN_VALUE_LIMIT_SIZE,
            })
          );
        }
        case "awsSqs": {
          if (!(driver instanceof AwsDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not an AWS connection.`);
          }
          const client = driver.getClientByResourceType<AwsSQSServiceClient>(ResourceType.Queue);
          if (!client) {
            throw new Error("SQS is not configured for this connection.");
          }
          const p = input.awsSqs!;
          return await client.scan(
            buildAwsSQSScanParams({
              queueUrl: p.queueUrl,
              bodyOrMessageIdContains: p.bodyOrMessageIdContains,
              limit,
            })
          );
        }
        case "awsCloudWatchLogGroup": {
          if (!(driver instanceof AwsDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not an AWS connection.`);
          }
          const client = driver.getClientByResourceType<AwsCloudwatchServiceClient>(ResourceType.LogGroup);
          if (!client) {
            throw new Error("CloudWatch Logs is not configured for this connection.");
          }
          const p = input.awsCloudWatchLogGroup!;
          return await client.scan(
            buildAwsCloudWatchLogGroupScanParams({
              logGroupName: p.logGroupName,
              insightsQuery: p.insightsQuery,
              startTime: toEpochSeconds(p.startTime),
              endTime: toEpochSeconds(p.endTime),
              limit,
            })
          );
        }
        case "awsCloudWatchLogStream": {
          if (!(driver instanceof AwsDriver)) {
            throw new Error(`Connection "${input.connectionName}" is not an AWS connection.`);
          }
          const client = driver.getClientByResourceType<AwsCloudwatchServiceClient>(ResourceType.LogStream);
          if (!client) {
            throw new Error("CloudWatch Logs is not configured for this connection.");
          }
          const p = input.awsCloudWatchLogStream!;
          return await client.scan(
            buildAwsCloudWatchLogStreamScanParams({
              logGroupName: p.logGroupName,
              logStreamName: p.logStreamName,
              startTime: toEpochSeconds(p.startTime),
              limit,
            })
          );
        }
      }
    },
    false
  );

  if (!result.ok || !result.result) {
    return { ok: false, message: result.message || `Failed to scan "${input.connectionName}".` };
  }
  return { ok: true, message: "", rdh: result.result };
}
