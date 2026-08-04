import {
  AwsDriver,
  AwsServiceType,
  DBDriverResolver,
} from "@l-v-yonsama/multi-platform-database-drivers";
import * as vscode from "vscode";
import { showWindowErrorMessage } from "./alertUtil";
import { StateStorage } from "./StateStorage";

/**
 * Fetches a single SSM parameter's / Secrets Manager secret's real (decrypted)
 * value on demand and writes it directly to the clipboard, entirely from the
 * extension host -- the value is never sent to a webview. Shared by the Scan
 * Panel's "Copy real value" button and the resource tree's "Copy real value"
 * context menu command, so both surfaces stay in sync with a single
 * implementation. There is deliberately no equivalent AI-tool-facing function;
 * see ScanResourceTool.ts's awsSsm/awsSecretsManager scan kinds, which only
 * ever expose metadata.
 */
export async function copyAwsSecretValueToClipboard(
  stateStorage: StateStorage,
  conName: string,
  serviceType: AwsServiceType,
  name: string
): Promise<void> {
  const setting = await stateStorage.getConnectionSettingByName(conName);
  if (!setting) {
    return;
  }

  const { ok, message, result } = await DBDriverResolver.getInstance().workflow(
    setting,
    async (driver): Promise<string | undefined> => {
      if (!(driver instanceof AwsDriver)) {
        throw new Error(`Connection "${conName}" is not an AWS connection.`);
      }
      if (serviceType === AwsServiceType.SSM) {
        if (!driver.ssmClient) {
          throw new Error("SSM is not configured for this connection.");
        }
        return await driver.ssmClient.getParameterValue(name);
      }
      if (serviceType === AwsServiceType.SecretsManager) {
        if (!driver.secretsManagerClient) {
          throw new Error("Secrets Manager is not configured for this connection.");
        }
        return await driver.secretsManagerClient.getSecretValue(name);
      }
      throw new Error(`Service "${serviceType}" does not support copying a real value.`);
    }
  );

  if (!ok) {
    showWindowErrorMessage(message);
    return;
  }
  if (result === undefined) {
    vscode.window.showWarningMessage(`No value found for "${name}".`);
    return;
  }
  await vscode.env.clipboard.writeText(result);
  vscode.window.showInformationMessage(`Copied the value of "${name}" to the clipboard.`);
}
