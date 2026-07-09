import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class MemcacheElementSetting extends BaseNoSqlElementSetting {
  getProtocol(): ElementSetting {
    return { visible: false };
  }

  getProtocolVersion(): ElementSetting {
    return { visible: false };
  }

  getHost(): ElementSetting {
    return { visible: true, label: "Servers", defaultValue: "localhost:11211" };
  }

  getPort(): ElementSetting<number> {
    return {
      visible: false,
      defaultValue: 11211,
    };
  }

  getUser(): ElementSetting {
    return { visible: false };
  }

  getPassword(): ElementSetting {
    return { visible: false };
  }

  getMqttClientId(): ElementSetting {
    return { visible: false };
  }

  // invisible ----------------

  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getConnectTimeoutMs(): ElementSetting {
    return {
      visible: true,
      label: "Connect timeout(ms)",
      defaultValue: "30000",
      placeholder: "time to wait before a CONNACK is received",
    };
  }

  getQueryTimeoutMs(): ElementSetting {
    return { visible: false };
  }

  getLockWaitTimeoutMs(): ElementSetting {
    return { visible: false };
  }

  getDatabase(): ElementSetting {
    return { visible: false };
  }

  getIamClientId(): ElementSetting {
    return { visible: false };
  }

  getIamClientSecret(): ElementSetting {
    return { visible: false };
  }

  getIamRetrieveResources(): ElementSetting {
    return { visible: false };
  }

  getUrl(): ElementSetting {
    return { visible: false };
  }

  // for aws
  getProfile(): ElementSetting {
    return { visible: false };
  }
  getAwsCredentialType(): ElementSetting {
    return { visible: false };
  }
  getSsl(): ElementSetting {
    return { visible: false };
  }

  accept(setting: ConnectionSetting): boolean {
    const { name, host } = setting;
    if (name === "" || host === "" ) {
      return false;
    }

    return true;
  }
}
