import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
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

  getHost(): ElementSetting {
    return {
      visible: true,
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
}
