import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

export abstract class BaseElementSetting {
  abstract getUser(): ElementSetting;

  abstract getPassword(): ElementSetting;

  abstract getTimezone(): ElementSetting;

  abstract getQueryTimeoutMs(): ElementSetting;

  abstract getLockWaitTimeoutMs(): ElementSetting;

  abstract getDatabase(): ElementSetting;

  abstract getIamClientId(): ElementSetting;

  abstract getIamClientSecret(): ElementSetting;

  abstract getIamRetrieveResources(): ElementSetting;

  abstract getHost(): ElementSetting;

  abstract getPort(): ElementSetting<number>;

  abstract getUrl(): ElementSetting;

  abstract getProfile(): ElementSetting;

  abstract getAwsCredentialType(): ElementSetting;

  abstract accept(setting: ConnectionSetting): boolean;

  abstract getSsl(): ElementSetting;

  abstract getSqlServerAuthenticationType(): ElementSetting;

  abstract getSqlServerClientId(): ElementSetting;

  abstract getSqlServerTenantId(): ElementSetting;

  abstract getSqlServerClientSecret(): ElementSetting;

  abstract getSqlServerConnectString(): ElementSetting;
}

export abstract class BaseNoSqlElementSetting extends BaseElementSetting {
  getSqlServerAuthenticationType(): ElementSetting {
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
}

export type ElementSetting<T extends string | number = string> = {
  visible: boolean;
  placeholder?: string;
  label?: string;
  defaultValue?: T;
};
