import type {
  ConnectionSetting,
  SQLServerAuthenticationType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseElementSetting, type ElementSetting } from "./BaseElementSetting";

abstract class RdsElementSetting extends BaseElementSetting {
  getUser(): ElementSetting {
    return {
      visible: true,
      label: "User",
    };
  }

  getPassword(): ElementSetting {
    return { visible: true, label: "Password" };
  }

  getTimezone(): ElementSetting {
    return { visible: true };
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
    return {
      visible: true,
      label: "Host",
      defaultValue: "127.0.0.1",
    };
  }

  getUrl(): ElementSetting {
    return { visible: false, label: "URL" };
  }

  // for aws
  getProfile(): ElementSetting {
    return { visible: false };
  }

  getAwsCredentialType(): ElementSetting {
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
    const { name, database, user, password } = setting;
    if (name === "") {
      return false;
    }

    if (database === "" || user === "" || password === "") {
      return false;
    }

    return true;
  }
}

export class MysqlElementSetting extends RdsElementSetting {
  getDatabase(): ElementSetting {
    return {
      visible: true,
      placeholder: "Database name",
      label: "DB name",
      defaultValue: "mysql",
    };
  }

  getPort(): ElementSetting<number> {
    return {
      visible: true,
      defaultValue: 3306,
    };
  }
  getSsl(): ElementSetting {
    return { visible: false };
  }
}

export class PostgresElementSetting extends RdsElementSetting {
  getDatabase(): ElementSetting {
    return {
      visible: true,
      placeholder: "Database name",
      label: "DB name",
      defaultValue: "postgres",
    };
  }

  getPort(): ElementSetting<number> {
    return {
      visible: true,
      defaultValue: 5432,
    };
  }
  getSsl(): ElementSetting {
    return {
      visible: true,
      placeholder: "SSL",
      label: "SSL",
    };
  }
}

export class SQLServerElementSetting extends RdsElementSetting {
  constructor(private params: { sqlServerAuthenticationType: SQLServerAuthenticationType }) {
    super();
  }

  getDatabase(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    return {
      visible: type !== "Use Connect String",
      placeholder: "Database name",
      label: "DB name",
      defaultValue: "master",
    };
  }
  getHost(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    return {
      visible: type !== "Use Connect String",
      label: type === "default" ? "Host" : "Server",
      defaultValue: type === "default" ? "127.0.0.1" : "",
      placeholder: type === "default" ? "" : "<SERVERNAME>.database.windows.net",
    };
  }
  getPort(): ElementSetting<number> {
    const type = this.params.sqlServerAuthenticationType;
    return {
      visible: type !== "Use Connect String",
      label: "Port",
      defaultValue: 1433,
    };
  }
  getUser(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    const visible =
      type !== "Use Connect String" &&
      type !== "azure-active-directory-default" &&
      type !== "azure-active-directory-msi-vm" &&
      type !== "azure-active-directory-service-principal-secret";
    return {
      visible,
      label: "User",
      defaultValue: "sa",
    };
  }

  getPassword(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    const visible =
      type !== "Use Connect String" &&
      type !== "azure-active-directory-default" &&
      type !== "azure-active-directory-msi-vm" &&
      type !== "azure-active-directory-service-principal-secret";
    return { visible, label: "Password", defaultValue: "" };
  }

  getSsl(): ElementSetting {
    return {
      visible: false,
      placeholder: "SSL",
      label: "SSL",
    };
  }
  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getSqlServerClientId(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    const isOptional =
      type === "azure-active-directory-default" || type === "azure-active-directory-msi-vm";
    return {
      visible: type !== "Use Connect String" && type !== "default",
      defaultValue: "",
      label: isOptional ? "ClientId(Optional)" : "ClientId",
      placeholder: "A client id to use",
    };
  }

  getSqlServerTenantId(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    const isVisible =
      type === "azure-active-directory-service-principal-secret" ||
      type === "azure-active-directory-password";
    return {
      visible: isVisible,
      label: type === "azure-active-directory-password" ? "TenantId(Optional)" : "TenantId",
      placeholder:
        type === "azure-active-directory-password"
          ? "Azure tenant ID"
          : "your registered Azure application",
      defaultValue: "",
    };
  }

  getSqlServerClientSecret(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    return {
      visible: type === "azure-active-directory-service-principal-secret",
      label: "Client secret",
    };
  }

  getSqlServerConnectString(): ElementSetting {
    const type = this.params.sqlServerAuthenticationType;
    return {
      visible: type === "Use Connect String",
      label: "Connect String",
      defaultValue: "",
      placeholder: "pass config as a connection string",
    };
  }
  accept(setting: ConnectionSetting): boolean {
    const type = this.params.sqlServerAuthenticationType;

    const { name, database, user, password, sqlServer } = setting;
    if (name === "") {
      return false;
    }

    if (type === "Use Connect String") {
      if (!sqlServer?.connectString) {
        return false;
      }
    } else {
      if (database === "" || user === "" || password === "") {
        return false;
      }
    }

    return true;
  }
}
