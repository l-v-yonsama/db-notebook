import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class RedisElementSetting extends BaseNoSqlElementSetting {
  getUser(): ElementSetting {
    return { visible: false };
  }

  getPassword(): ElementSetting {
    return { visible: true, label: "Password" };
  }

  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getQueryTimeoutMs(): ElementSetting {
    return { visible: false };
  }

  getLockWaitTimeoutMs(): ElementSetting {
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
