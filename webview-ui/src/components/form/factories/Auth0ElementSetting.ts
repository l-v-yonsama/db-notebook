import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class Auth0ElementSetting extends BaseNoSqlElementSetting {
  getUser(): ElementSetting {
    return {
      visible: false,
    };
  }

  getPassword(): ElementSetting {
    return {
      visible: false,
    };
  }

  getTimezone(): ElementSetting {
    return { visible: false };
  }

  getDatabase(): ElementSetting {
    return {
      visible: false,
    };
  }

  getIamClientId(): ElementSetting {
    return {
      visible: true,
      placeholder: "client-id",
      defaultValue: "",
      label: "Client id",
    };
  }

  getIamClientSecret(): ElementSetting {
    return {
      visible: true,
      placeholder: "client-secret",
      defaultValue: "",
      label: "Client secret",
    };
  }

  getIamRetrieveResources(): ElementSetting {
    return { visible: true };
  }

  getHost(): ElementSetting {
    return {
      visible: true,
      label: "Domain",
      placeholder: "xxx.xxx.auth0.com",
    };
  }

  getPort(): ElementSetting<number> {
    return { visible: false };
  }

  getUrl(): ElementSetting {
    return {
      visible: false,
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
    const { name, host, iamSolution } = setting;
    if (name === "" || iamSolution === undefined) {
      return false;
    }

    const { clientId, clientSecret } = iamSolution;

    if (clientId === "" || clientSecret === "" || host === "") {
      return false;
    }

    return true;
  }
}
