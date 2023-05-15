export const ResourceType = {
  Connection: "Connection",
  RdsDatabase: "RdsDatabase",
  AwsDatabase: "AwsDatabase",
  RedisDatabase: "RedisDatabase",
  Schema: "Schema",
  Table: "Table",
  Column: "Column",
  Key: "Key",
  Bucket: "Bucket",
  Queue: "Queue",
  Owner: "Owner",
  LogGroup: "LogGroup",
  LogStream: "LogStream",
} as const;

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];
