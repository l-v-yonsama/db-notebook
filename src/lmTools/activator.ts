import { ExtensionContext, lm } from "vscode";
import { StateStorage } from "../utilities/StateStorage";
import { GetSchemaTool } from "./GetSchemaTool";
import { ListConnectionsTool } from "./ListConnectionsTool";
import { RunQueryTool } from "./RunQueryTool";
import { RunTransactionTool } from "./RunTransactionTool";
import { ScanResourceTool } from "./ScanResourceTool";
import { TestConnectionTool } from "./TestConnectionTool";

export function activateLmTools(context: ExtensionContext, stateStorage: StateStorage) {
  context.subscriptions.push(
    lm.registerTool("database-notebook_testConnection", new TestConnectionTool(stateStorage))
  );
  context.subscriptions.push(
    lm.registerTool("database-notebook_listConnections", new ListConnectionsTool(stateStorage))
  );
  context.subscriptions.push(
    lm.registerTool("database-notebook_getSchema", new GetSchemaTool(stateStorage))
  );
  context.subscriptions.push(
    lm.registerTool("database-notebook_runQuery", new RunQueryTool(stateStorage))
  );
  context.subscriptions.push(
    lm.registerTool("database-notebook_scanResource", new ScanResourceTool(stateStorage))
  );
  context.subscriptions.push(
    lm.registerTool("database-notebook_runTransaction", new RunTransactionTool(stateStorage))
  );
}
