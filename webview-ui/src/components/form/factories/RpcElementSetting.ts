import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class RpcElementSetting extends BaseNoSqlElementSetting {
  getHost(): ElementSetting {
    return { visible: true, label: "Host", defaultValue: "localhost" };
  }

  getPort(): ElementSetting<number> {
    return { visible: true, defaultValue: 50051 };
  }

  getConnectTimeoutMs(): ElementSetting {
    return { visible: true, label: "Connect timeout(ms)" };
  }

  getQueryTimeoutMs(): ElementSetting {
    return { visible: true, label: "RPC timeout(ms)" };
  }

  getUser(): ElementSetting { return { visible: false }; }
  getPassword(): ElementSetting { return { visible: false }; }
  getTimezone(): ElementSetting { return { visible: false }; }
  getLockWaitTimeoutMs(): ElementSetting { return { visible: false }; }
  getDatabase(): ElementSetting { return { visible: false }; }
  getIamClientId(): ElementSetting { return { visible: false }; }
  getIamClientSecret(): ElementSetting { return { visible: false }; }
  getIamRetrieveResources(): ElementSetting { return { visible: false }; }
  getUrl(): ElementSetting { return { visible: false }; }
  getProfile(): ElementSetting { return { visible: false }; }
  getAwsCredentialType(): ElementSetting { return { visible: false }; }
  getSsl(): ElementSetting { return { visible: false }; }

  accept(setting: ConnectionSetting): boolean {
    if (!setting.name?.trim() || !setting.host?.trim() ||
      !Number.isInteger(setting.port) || setting.port! < 1 || setting.port! > 65535 ||
      !setting.rpc ||
      (setting.rpc.streamTimeoutMs !== undefined &&
        (!Number.isSafeInteger(setting.rpc.streamTimeoutMs) || setting.rpc.streamTimeoutMs < 0)) ||
      (setting.rpc.discovery !== "reflection" && !setting.rpc.protoFilePath?.trim())) {
      return false;
    }
    const auth = setting.rpc.authentication;
    return auth?.type === "bearer"
      ? setting.ssl?.use === true && !!auth.token?.trim()
      : auth?.type === "none" && setting.ssl?.use !== true;
  }
}
