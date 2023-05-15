export declare const RedisKeyType: {
  readonly string: "string";
  readonly list: "list";
  readonly set: "set";
  readonly zset: "zset";
  readonly hash: "hash";
  readonly unknown: "unknown";
};
export type RedisKeyType = (typeof RedisKeyType)[keyof typeof RedisKeyType];
export declare const RedisKeyTypeValues: (
  | "string"
  | "list"
  | "set"
  | "zset"
  | "hash"
  | "unknown"
)[];
