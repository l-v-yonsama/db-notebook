import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseElementSetting, type ElementSetting } from "./BaseElementSetting";

export class Auth0ElementSetting extends BaseElementSetting {
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
    };
  }

  getIamClientSecret(): ElementSetting {
    return {
      visible: true,
      placeholder: "client-secret",
      defaultValue: "",
    };
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
