import type { AwsSQSAttributes } from "./AwsSQSAttributes";
import type { AwsServiceType } from "./AwsServiceType";
import type { SupplyCredentialType } from "./AwsSupplyCredentialType";
import type { CompareKey } from "./CompareKey";
import type { DBType } from "./DBType";
import type { GeneralColumnType } from "./GeneralColumnType";
import type { RedisKeyType } from "./RedisKeyType";
import type { ResourceType } from "./ResourceType";

export interface SchemaAndTableName {
  schema?: string;
  table: string;
}
export interface TableRows extends SchemaAndTableName {
  count: number;
}
export interface SchemaAndTableHints {
  list: SchemaAndTableName[];
}
export interface ColumnResolver {
  hints: SchemaAndTableHints;
}
export declare function fromJson<T extends DbResource>(json: any): T;
export type DbDatabase = RdsDatabase | AwsDatabase | RedisDatabase;
type AllSubDbResource =
  | DbConnection
  | RdsDatabase
  | AwsDatabase
  | RedisDatabase
  | DbSchema
  | DbTable
  | DbKey
  | DbColumn
  | DbS3Bucket
  | DbSQSQueue
  | DbLogGroup
  | DbLogStream
  | DbS3Owner;
export declare abstract class DbResource<T extends DbResource = AllSubDbResource> {
  id: string;
  readonly resourceType: ResourceType;
  readonly name: string;
  comment?: string;
  readonly children: Array<T>;
  meta: {
    [key: string]: any;
  };
  isInProgress?: boolean;
  constructor(resourceType: ResourceType, name: string);
  getProperties(): {
    [key: string]: any;
  };
  addChild(res: T): T;
  hasChildren(): boolean;
  clearChildren(): void;
  getChildByName(name: string, insensitive?: boolean): T | undefined;
  findChildren<U extends DbResource = AllSubDbResource>({
    keyword,
    resourceType,
    recursively,
  }: {
    resourceType: ResourceType;
    keyword?: string | RegExp;
    recursively?: boolean;
  }): U[];
  toString(): string;
  toJsonStringify(space?: number): string;
}
export interface SshSetting {
  use: boolean;
  authMethod: string;
  username: string;
  password?: string;
  host: string;
  port: number;
  privateKeyPath?: string;
  privateKey?: string;
  passphrase?: string;
  dstPort: number;
  dstHost: string;
}
export type AwsSetting = {
  supplyCredentialType: SupplyCredentialType;
  profile?: string;
  region?: string;
  services: AwsServiceType[];
  s3ForcePathStyle?: boolean;
};
export interface FirebaseSetting {
  authMethod: string;
  projectid?: string;
  privateKey?: string;
  clientEmail?: string;
  serviceAccountCredentialsPath?: string;
}
export interface ConnectionSetting {
  dbType: DBType;
  name: string;
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  databaseVersion?: number;
  ds?: string;
  apiVersion?: string;
  ssh?: SshSetting;
  awsSetting?: AwsSetting;
  firebase?: FirebaseSetting;
}
export declare class DbConnection extends DbResource implements ConnectionSetting {
  dbType: any;
  name: string;
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  databaseVersion?: number;
  ds?: string;
  isConnected: boolean;
  apiVersion?: string;
  ssh?: SshSetting;
  awsSetting?: AwsSetting;
  firebase?: FirebaseSetting;
  constructor(prop: any);
  hasUrl(): boolean;
  hasSshSetting(): boolean;
}
export declare class RdsDatabase extends DbResource<DbSchema> {
  version?: number;
  constructor(name: string);
  getProperties(): {
    [key: string]: any;
  };
  getSchema(option: { name?: string; isDefault?: boolean }): DbSchema;
}
export declare class AwsDatabase extends DbResource<
  DbS3Bucket | DbSQSQueue | DbLogGroup | DbS3Owner
> {
  readonly serviceType: AwsServiceType;
  constructor(name: string, serviceType: AwsServiceType);
}
export declare class RedisDatabase extends DbResource<DbKey> {
  numOfKeys: number;
  constructor(name: string, numOfKeys: number);
  getDBIndex(): number;
  getProperties(): {
    [key: string]: any;
  };
}
export declare class DbSchema extends DbResource<DbTable> {
  isDefault: boolean;
  constructor(name: string);
}
export declare class DbTable extends DbResource<DbColumn> {
  tableType: any;
  constructor(name: string, tableType: any, comment?: string);
  getCompareKeys(): CompareKey[];
  getPrimaryColumnNames(): string[];
  getUniqColumnNames(): string[];
  toString(): string;
  getProperties(): {
    [key: string]: any;
  };
}
export declare class DbKey<
  T extends RedisKeyParams | S3KeyParams | SQSMessageParams | LogMessageParams = any
> extends DbResource {
  readonly params: T;
  constructor(name: string, params: T);
  getProperties(): {
    [key: string]: any;
  };
}
export type RedisKeyParams = {
  type: RedisKeyType;
  ttl: number;
  val?: any;
  base64?: string;
};
export type S3KeyParams = {
  outputFilePath?: string;
  lastModified: Date;
  etag: string;
  size: number;
  storageClass: string;
  base64?: string;
};
export type SQSMessageParams = {
  body: string;
  receiptHandle: string;
  md5OfBody: string;
  sentTimestamp: Date;
  approximateFirstReceiveTimestamp: Date;
};
export type LogMessageParams = {
  message: string;
};
export declare class DbColumn extends DbResource {
  readonly colType: GeneralColumnType;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly uniqKey: boolean;
  readonly default: any;
  readonly extra: any;
  constructor(name: string, colType: GeneralColumnType, params: any, comment?: string);
  toString(): string;
  getProperties(): {
    [key: string]: any;
  };
}
export declare class AwsDbResource<T = any> extends DbResource {
  readonly attr: T;
  private dateProperties?;
  private byteProperties?;
  constructor(resourceType: ResourceType, name: string, attr: T);
  protected setPropertyFormat({ dates, bytes }: { dates?: string[]; bytes?: string[] }): void;
  getProperties(): {
    [key: string]: any;
  };
}
export declare class DbS3Bucket extends AwsDbResource<{
  CreationDate?: Date;
}> {
  constructor(name?: string, CreationDate?: Date);
}
export declare class DbSQSQueue extends AwsDbResource<AwsSQSAttributes> {
  readonly url: string;
  constructor(name: string, url: string, attr: AwsSQSAttributes);
  getProperties(): {
    [key: string]: any;
  };
}
export declare class DbLogGroup extends AwsDbResource<{
  creationTime?: number;
  storedBytes?: number;
  retentionInDays?: number;
  kmsKeyId?: string;
}> {
  constructor(
    name: string,
    attr: {
      creationTime?: number;
      storedBytes?: number;
      retentionInDays?: number;
      kmsKeyId?: string;
    }
  );
}
export declare class DbLogStream extends AwsDbResource<{
  creationTime: Date;
  firstEventTimestamp: Date;
  lastEventTimestamp: Date;
  lastIngestionTime: Date;
}> {
  constructor(
    name: string,
    attr: {
      creationTime: Date;
      firstEventTimestamp: Date;
      lastEventTimestamp: Date;
      lastIngestionTime: Date;
    }
  );
}
export declare class DbS3Owner extends AwsDbResource<{}> {
  readonly ownerId: string;
  constructor(ownerId: string, name: string);
  getProperties(): {
    [key: string]: any;
  };
}
export {};
