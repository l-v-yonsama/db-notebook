import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class MqttElementSetting extends BaseNoSqlElementSetting {
  getProtocol(): ElementSetting {
    return { visible: true, label: "Protocol", defaultValue: "mqtt" };
  }

  getProtocolVersion(): ElementSetting {
    return { visible: true, label: "Protocol-version", defaultValue: "4" };
  }

  getHost(): ElementSetting {
    return { visible: true, label: "Host", defaultValue: "test.mosquitto.org" };
  }

  getPort(): ElementSetting<number> {
    return {
      visible: true,
      defaultValue: 1883,
    };
  }

  getUser(): ElementSetting {
    return { visible: true, label: "Username(Optional)", defaultValue: "" };
  }

  getPassword(): ElementSetting {
    return { visible: true, label: "Password(Optional)", defaultValue: "" };
  }

  getMqttClientId(): ElementSetting {
    return {
      visible: true,
      label: "ClientId",
      defaultValue: "",
      placeholder: "auto-generated if empty",
    };
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
    const { name, host, port, mqttSetting } = setting;
    if (name === "" || host === "" || port === undefined || mqttSetting === undefined) {
      return false;
    }

    return true;
  }
}
