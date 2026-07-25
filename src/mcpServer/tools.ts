import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSchemaText } from "../lmTools/GetSchemaTool";
import { listConnectionsText } from "../lmTools/ListConnectionsTool";
import { runQueryText } from "../lmTools/RunQueryTool";
import { runTransactionText } from "../lmTools/RunTransactionTool";
import { scanResourceText } from "../lmTools/ScanResourceTool";
import { testConnectionText } from "../lmTools/TestConnectionTool";
import { StateStorage } from "../utilities/StateStorage";

/**
 * Phase 1 + 2 scope: all 6 connection/schema/query tools (everything except the
 * notebook-authoring tools, `createDbNotebook`/`editDbNotebook`, which stay
 * Copilot-only for now -- see `misc/mcp-server-implementation-plan-2026-07-23.md`).
 * `description`s below are copied verbatim from `package.json`'s
 * `contributes.languageModelTools` (the Copilot Chat versions of these same tools) so
 * both surfaces stay in sync and describe identical behavior.
 *
 * Each handler here calls the same `xxxText(...)` orchestrator used by the
 * corresponding Copilot-side `LanguageModelTool` class's `invoke()` -- fetching,
 * formatting, logging, and error handling all happen once in that shared function, so
 * neither call site (Copilot or MCP) repeats that logic.
 */
export function registerTools(server: McpServer, stateStorage: StateStorage): void {
  server.registerTool(
    "listDbConnections",
    {
      description:
        "Lists the database connections configured in Database Notebook that are allowed for AI tool access: name, database/resource type, environment label (e.g. local/development/staging/production, if set), an optional free-text description of what the connection is for, and a short type-specific detail (e.g. which AWS services -- DynamoDB, S3, CloudWatch Logs, SQS, SES -- an AWS connection is configured for, the protocol for an MQTT connection, or whether a SQL connection (MySQL/PostgreSQL/SQL Server/SQLite) is marked read-only -- for SQL Server this is only a routing hint, not an enforced guarantee, so write attempts can still succeed there). No credentials are included. Use this when the user asks what connections exist, which databases/services they can use, what a given connection is configured for, which one is the local/dev/production one, or asks a question like 'which connection was it again?' before using another Database Notebook tool such as checking connectivity or running a query. A connection marked read-only will reject write/DDL statements (except the SQL Server hint-only case above) -- prefer it for read-heavy tasks and avoid it, or warn the user, before attempting writes.",
      inputSchema: {},
    },
    async () => {
      const text = listConnectionsText(stateStorage);
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "testDbConnection",
    {
      description:
        "Performs a live network connectivity test against a specific named database connection saved in Database Notebook's DB Explorer, by actually attempting to connect right now. Use this tool whenever the user asks things like 'is connection X reachable/working/up?', 'can I connect to X?', 'test/check/verify/troubleshoot the X connection' for any connection managed by Database Notebook (.dbn files, MySQL/PostgreSQL/SQL Server/SQLite/Redis/etc.). This performs a real, live check -- do not answer from static analysis of files or guesses, call this tool to get the current, authoritative answer. Requires the exact saved connection name; if the given name doesn't match, the tool returns the list of valid connection names instead. If you don't already know the exact connection name -- e.g. the user described it indirectly, like 'the local MySQL connection' or 'the production database' -- call listDbConnections first to resolve it by name/dbType/environment/description rather than guessing the name.",
      inputSchema: {
        connectionName: z
          .string()
          .describe("The exact name of the connection as configured in Database Notebook's DB Explorer."),
      },
    },
    async ({ connectionName }) => {
      const text = await testConnectionText(stateStorage, connectionName);
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "getDbSchema",
    {
      description:
        "Returns schema or resource information for a connection managed by Database Notebook, in a format appropriate to its type. For a SQL connection (MySQL, PostgreSQL, SQL Server, SQLite): the CREATE TABLE DDL (columns, types, primary/foreign keys, comments) for a table, or all tables -- optionally narrow with schemaName and/or tableName. For an AWS connection: the configured resources -- S3 bucket names, SQS queue names/URLs, CloudWatch log group names, and DynamoDB table key schemas (partition/sort key, attribute types, GSI/LSI counts) -- optionally narrow with serviceType and/or resourceName. For a Redis connection: each DB index and its key count. For a Memcache connection: key counts per cache tier (hot/warm/cold) and the configured servers. For a Keycloak connection: each realm with user/group counts -- optionally narrow with realmName. For an Auth0 connection: user/organization counts, plus organization/client lists where the connection is configured to retrieve them. For an MQTT connection: the configured topic subscriptions with QoS. All filters are optional and independent; omit any of them to get every match. Use this when the user asks about table/resource structure, columns, relationships, or before writing SQL/inspecting resources against a connection you haven't inspected yet. For searching/browsing individual records or keys within a resource (not just its structure/summary), use scanDbResource instead. If you don't already know the exact connection name -- e.g. the user described it indirectly, like 'the local MySQL connection' or 'the production database' -- call listDbConnections first to resolve it by name/dbType/environment/description rather than guessing the name.",
      inputSchema: {
        connectionName: z
          .string()
          .describe("The exact name of the connection as configured in Database Notebook's DB Explorer."),
        schemaName: z
          .string()
          .optional()
          .describe("SQL connections only. Optional: limit results to tables in a single schema/database. Omit to search every schema."),
        tableName: z
          .string()
          .optional()
          .describe("SQL connections only. Optional: limit results to a single table name. Omit to get every table."),
        serviceType: z
          .enum(["S3", "SQS", "SES", "Cloudwatch", "DynamoDB"])
          .optional()
          .describe("AWS connections only. Optional: limit results to a single AWS service. Omit to include every configured service."),
        resourceName: z
          .string()
          .optional()
          .describe("AWS connections only. Optional: limit results to a single bucket/queue/log group/table name. Omit to get every resource."),
        realmName: z
          .string()
          .optional()
          .describe("Keycloak connections only. Optional: limit results to a single realm name. Omit to get every realm."),
      },
    },
    async ({ connectionName, schemaName, tableName, serviceType, resourceName, realmName }) => {
      const text = await getSchemaText(stateStorage, connectionName, {
        schemaName,
        tableName,
        serviceType,
        resourceName,
        realmName,
      });
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "runDbQuery",
    {
      description:
        "Runs a SQL statement against a SQL connection (MySQL, PostgreSQL, SQL Server, SQLite) managed by Database Notebook, or a PartiQL statement against an AWS connection configured for DynamoDB, and returns the results. Prefer read-only SELECT/EXPLAIN/SHOW statements. Write/DDL statements (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/etc.) will always require the user's explicit confirmation before running, and on SQL Server or DynamoDB connections every statement requires confirmation regardless of type. Not supported for other non-SQL connections (Redis, MQTT, other AWS resources like S3/SQS/CloudWatch, etc.) -- use scanDbResource to search those instead. To run multiple statements as one atomic transaction, use runDbTransaction instead of calling this tool repeatedly (DynamoDB connections are not supported by runDbTransaction). Use getDbSchema first if you don't already know the table structure. If you don't already know the exact connection name -- e.g. the user described it indirectly, like 'the local MySQL connection' or 'the production database' -- call listDbConnections first to resolve it by name/dbType/environment/description rather than guessing the name. Note: when called via an MCP client (rather than GitHub Copilot Chat), write/DDL confirmation is handled by that client's own tool-approval UI, not by a Database Notebook-specific dialog -- the DB-engine-level read-only session enforcement described above still applies regardless of client.",
      inputSchema: {
        connectionName: z
          .string()
          .describe("The exact name of the connection as configured in Database Notebook's DB Explorer."),
        sql: z.string().describe("The SQL statement to run."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ connectionName, sql }) => {
      const text = await runQueryText(stateStorage, connectionName, sql);
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "scanDbResource",
    {
      description:
        "Searches/browses data in a non-SQL connection managed by Database Notebook (Redis, Memcache, Mqtt, Keycloak, Auth0, or AWS S3/SQS/CloudWatch Logs) using resource-specific scan parameters, since these connections cannot run SQL. Not supported for SQL connections (MySQL, PostgreSQL, SQL Server, SQLite) or AWS DynamoDB -- use runDbQuery for SQL connections. Set connectionName and fill in exactly ONE of the nested parameter objects matching the connection's type: redis, memcache, mqtt, awsS3, awsSqs, awsCloudWatchLogGroup, awsCloudWatchLogStream, keycloak, or auth0 -- each object's fields only apply to that connection type, do not mix fields from different objects. Call getDbSchema first if you don't know the connection's exact resource names (bucket/queue/log group/log stream names) or which AWS sub-resource it is, and call listDbConnections first if you don't know the exact connection name. Mqtt scanning requires the connection to already be connected and subscribed to the relevant topics via the MQTT panel -- it does not auto-connect, and returns an error telling you so if it isn't.",
      inputSchema: {
        connectionName: z
          .string()
          .describe("The exact name of the connection as configured in Database Notebook's DB Explorer."),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results to return. Defaults to the configured default query row limit."),
        redis: z
          .object({
            dbIndex: z.number().optional().describe("DB index to scan. Defaults to 0."),
            keyGlob: z
              .string()
              .optional()
              .describe('SCAN MATCH glob pattern applied to key names (e.g. "session:*"). Defaults to all keys.'),
            fetchValueLimitSize: z
              .number()
              .optional()
              .describe("Byte size cap for including a matched key's value in the result."),
          })
          .optional()
          .describe("Scan a Redis connection. Use only when connectionName refers to a Redis connection."),
        memcache: z
          .object({
            key: z.string().describe("The key name."),
            matchType: z
              .enum(["exact", "partial"])
              .describe("'exact': key must equal a key name exactly. 'partial': key is matched as a substring."),
          })
          .optional()
          .describe("Scan a Memcache connection. Use only when connectionName refers to a Memcache connection."),
        mqtt: z
          .object({
            topicFilter: z
              .string()
              .optional()
              .describe("Subscription topic filter to scan. Empty/omitted scans across all subscribed topics."),
            matchType: z
              .enum(["exact", "partial"])
              .optional()
              .describe("'exact': topicFilter must equal a subscription exactly. 'partial' (default): wildcard/substring match."),
            payloadContains: z.string().optional().describe("Substring match against the message payload text."),
            startTime: z.string().optional().describe("Optional ISO 8601 start of a message-timestamp range filter."),
            endTime: z.string().optional().describe("Optional ISO 8601 end of a message-timestamp range filter."),
            jsonExpansion: z
              .boolean()
              .optional()
              .describe("Expand nested JSON payloads into individual columns. Only applied when a single topic matched."),
            fetchValueLimitSize: z
              .number()
              .optional()
              .describe("Byte size cap for including a message's payload in the result."),
          })
          .optional()
          .describe(
            "Scan an Mqtt connection. Use only when connectionName refers to an Mqtt connection. The connection must already be connected and subscribed to the relevant topics via the MQTT panel before scanning."
          ),
        awsS3: z
          .object({
            bucketName: z.string().describe("The S3 bucket name. Call getDbSchema first to find exact bucket names."),
            keyPrefix: z.string().optional().describe("Object key prefix filter."),
            lastModifiedAfter: z.string().optional().describe("Optional ISO 8601 start of a LastModified range filter."),
            lastModifiedBefore: z.string().optional().describe("Optional ISO 8601 end of a LastModified range filter."),
            fetchValueLimitSize: z
              .number()
              .optional()
              .describe("Byte size cap for including an object's body in the result."),
          })
          .optional()
          .describe("Scan an AWS S3 bucket. Use only when connectionName refers to an AWS connection and the target resource is an S3 bucket."),
        awsSqs: z
          .object({
            queueUrl: z.string().describe("The SQS queue URL. Call getDbSchema first to find exact queue URLs."),
            bodyOrMessageIdContains: z.string().optional().describe("Substring match against the message body or messageId."),
          })
          .optional()
          .describe("Scan an AWS SQS queue. Use only when connectionName refers to an AWS connection and the target resource is an SQS queue."),
        awsCloudWatchLogGroup: z
          .object({
            logGroupName: z.string().describe("The CloudWatch log group name. Call getDbSchema first to find exact log group names."),
            insightsQuery: z.string().optional().describe("A CloudWatch Logs Insights query string."),
            startTime: z.string().optional().describe("Optional ISO 8601 start of the query's time range."),
            endTime: z.string().optional().describe("Optional ISO 8601 end of the query's time range."),
          })
          .optional()
          .describe(
            "Run a CloudWatch Logs Insights query against a log group. Use only when connectionName refers to an AWS connection and the target resource is a CloudWatch log group."
          ),
        awsCloudWatchLogStream: z
          .object({
            logGroupName: z.string().describe("The parent log group's name."),
            logStreamName: z.string().describe("The log stream name. Call getDbSchema first to find exact log stream names."),
            startTime: z.string().optional().describe("Optional ISO 8601 start of a timestamp range filter (there is no end bound)."),
          })
          .optional()
          .describe("Scan a single CloudWatch log stream. Use only when connectionName refers to an AWS connection and the target resource is a CloudWatch log stream."),
        keycloak: z
          .object({
            resourceType: z
              .enum(["IamRealm", "IamGroup", "IamRole", "IamUser", "IamSession"])
              .describe("Which kind of Keycloak resource to list."),
            realmName: z.string().optional().describe('Realm name. Required except for resourceType "IamRealm".'),
            parentId: z.string().optional().describe('Client or group id to scope results to. Only used by "IamSession".'),
            searchQuery: z.string().optional().describe("Free-text search, passed through to Keycloak's own search param."),
            jsonExpansion: z
              .boolean()
              .optional()
              .describe('Expand the nested attributes object into individual columns. Only used by "IamUser".'),
          })
          .optional()
          .describe("Scan a Keycloak connection. Use only when connectionName refers to a Keycloak connection."),
        auth0: z
          .object({
            resourceType: z
              .enum(["IamClient", "IamUser", "IamRole", "IamOrganization"])
              .describe("Which kind of Auth0 resource to list."),
            parentId: z.string().optional().describe('Organization id to scope results to its members. Only used by "IamUser".'),
            searchQuery: z.string().optional().describe("Free-text search, passed through to the Auth0 Management API."),
            jsonExpansion: z.boolean().optional().describe("Expand nested metadata objects into individual columns."),
          })
          .optional()
          .describe("Scan an Auth0 connection. Use only when connectionName refers to an Auth0 connection."),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const text = await scanResourceText(stateStorage, input);
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "runDbTransaction",
    {
      description:
        "Runs multiple SQL statements against a SQL connection (MySQL, PostgreSQL, SQL Server, SQLite) managed by Database Notebook as a single atomic transaction, in order, stopping at the first failure. Use this instead of calling runDbQuery repeatedly whenever the statements must all succeed or all be undone together (e.g. a sequence of INSERT/UPDATE/DELETE across related tables). For a single statement, use runDbQuery instead. Choose transactionControlType carefully: 'rollbackOnError' (default, recommended) commits only if every statement succeeds and rolls back everything on any failure; 'alwaysCommit' commits whatever ran even after a failure, keeping partial writes -- use only when partial progress is acceptable; 'alwaysRollback' always rolls back even on full success, useful for a dry run. Not supported for non-SQL connections (Redis, Memcache, MQTT, Keycloak, Auth0, AWS) -- use scanDbResource for those. If you don't already know the exact connection name, call listDbConnections first, and use getDbSchema first if you don't already know the table structure. Note: when called via an MCP client (rather than GitHub Copilot Chat), confirmation before running is handled by that client's own tool-approval UI, not by a Database Notebook-specific dialog.",
      inputSchema: {
        connectionName: z
          .string()
          .describe("The exact name of the connection as configured in Database Notebook's DB Explorer."),
        statements: z.array(z.string()).describe("The SQL statements to run in order, inside one transaction."),
        transactionControlType: z
          .enum(["rollbackOnError", "alwaysCommit", "alwaysRollback"])
          .optional()
          .describe(
            "How to commit/roll back. 'rollbackOnError' (default): commit only if all statements succeed. 'alwaysCommit': commit even after a failure (partial writes kept). 'alwaysRollback': always roll back, even on success (dry run)."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async ({ connectionName, statements, transactionControlType }) => {
      const text = await runTransactionText(
        stateStorage,
        connectionName,
        statements,
        transactionControlType ?? "rollbackOnError"
      );
      return { content: [{ type: "text", text }] };
    }
  );
}
