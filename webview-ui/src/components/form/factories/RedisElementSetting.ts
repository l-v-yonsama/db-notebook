import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseElementSetting, type ElementSetting } from "./BaseElementSetting";

export class RedisElementSetting extends BaseElementSetting {
  getUser(): ElementSetting {
    return { visible: false };
  }

  getPassword(): ElementSetting {
    return { visible: true, label: "Password" };
  }

  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getDatabase(): ElementSetting {
    return {
      visible: true,
      placeholder: "Index to use",
      label: "Index to use",
      defaultValue: "0",
    };
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

  getHost(): ElementSetting {
    return { visible: true, label: "Host" };
  }

  getPort(): ElementSetting<number> {
    return {
      visible: true,
      defaultValue: 6379,
    };
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

  getSqlServerClientId(): ElementSetting {
    return { visible: false };
  }

  getSqlServerTenantId(): ElementSetting {
    return { visible: false };
  }

  getSqlServerClientSecret(): ElementSetting {
    return { visible: false };
  }

  getSqlServerConnectString(): ElementSetting {
    return { visible: false };
  }

  accept(setting: ConnectionSetting): boolean {
    const { name, database } = setting;
    if (name === "") {
      return false;
    }

    if (database === "") {
      return false;
    }

    return true;
  }
}
