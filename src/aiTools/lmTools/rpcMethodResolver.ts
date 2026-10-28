import {
  DBType,
  RpcDatabase,
  RpcMethod,
  RpcService,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { StateStorage } from "../../utilities/StateStorage";

export type ResolvedRpcMethod = {
  database: RpcDatabase;
  service: RpcService;
  method: RpcMethod;
};

/** Resolve a discovered method by service and method name, without guessing on ambiguity. */
export async function resolveRpcMethod(
  stateStorage: StateStorage,
  connectionName: string,
  serviceName: string,
  methodName: string
): Promise<ResolvedRpcMethod> {
  if (stateStorage.getDBTypeByConnectionName(connectionName) !== DBType.RPC) {
    throw new Error(`"${connectionName}" is not an RPC connection.`);
  }
  const loaded = await stateStorage.loadResource(connectionName, false, true);
  if (!loaded.ok || !loaded.result) {
    throw new Error(loaded.message || `Could not load RPC descriptors for "${connectionName}".`);
  }
  const matches: ResolvedRpcMethod[] = [];
  for (const database of loaded.result.db) {
    if (!(database instanceof RpcDatabase)) {
      continue;
    }
    for (const pkg of database.children) {
      for (const service of pkg.children) {
        if (service.fullName !== serviceName && service.name !== serviceName) {
          continue;
        }
        for (const method of service.children) {
          if (method.name === methodName) {
            matches.push({ database, service, method });
          }
        }
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `RPC method "${serviceName}/${methodName}" was not found on "${connectionName}".`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `RPC method "${serviceName}/${methodName}" is ambiguous; use the fully qualified service name.`
    );
  }
  return matches[0];
}
