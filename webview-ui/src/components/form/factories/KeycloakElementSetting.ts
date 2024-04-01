import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseElementSetting, type ElementSetting } from "./BaseElementSetting";

export class KeycloakElementSetting extends BaseElementSetting {
  getUser(): ElementSetting {
    return {
      visible: true,
      label: "User name",
    };
  }

  getPassword(): ElementSetting {
    return {
      visible: true,
      label: "Password",
    };
  }

  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getDatabase(): ElementSetting {
    return {
      visible: true,
      placeholder: "Default realm",
      label: "Default realm",
      defaultValue: "master",
    };
  }

  getIamClientId(): ElementSetting {
    return {
      visible: true,
      placeholder: "admin-cli",
      defaultValue: "admin-cli",
    };
  }

  getIamClientSecret(): ElementSetting {
    return { visible: false };
  }

  getIamRetrieveResources(): ElementSetting {
    return { visible: true };
  }

  getHost(): ElementSetting {
    return { visible: false };
  }

  getPort(): ElementSetting<number> {
    return { visible: false };
  }

  getUrl(): ElementSetting {
    return {
      visible: true,
      label: "Issuer base url",
      defaultValue: "http://localhost:8080",
    };
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
    const { name, database, user, password, url, iamSolution } = setting;
    if (name === "" || iamSolution === undefined) {
      return false;
    }
    const { clientId } = iamSolution;

    if (database === "" || user === "" || password === "" || url === "" || clientId === "") {
      return false;
    }

    return true;
  }
}
