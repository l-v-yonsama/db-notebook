import { SupplyCredentials } from "@/types/lib/AwsSupplyCredentialType";
import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { BaseNoSqlElementSetting, type ElementSetting } from "./BaseElementSetting";

export class AwsElementSetting extends BaseNoSqlElementSetting {
  constructor(private params: { awsCredentialType: string }) {
    super();
  }

  getUser(): ElementSetting {
    return {
      visible: this.params.awsCredentialType === SupplyCredentials.ExplicitInProperty,
      label: "Access key ID",
      defaultValue: "",
    };
  }

  getPassword(): ElementSetting {
    return {
      visible: this.params.awsCredentialType === SupplyCredentials.ExplicitInProperty,
      label: "Secret access key",
      defaultValue: "",
    };
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
    return { visible: false };
  }

  getIamClientId(): ElementSetting {
    return { visible: false };
  }

  getIamRetrieveResources(): ElementSetting {
    return { visible: false };
  }

  getIamClientSecret(): ElementSetting {
    return { visible: false };
  }

  getHost(): ElementSetting {
    return { visible: false };
  }

  getPort(): ElementSetting<number> {
    return { visible: false };
  }

  getUrl(): ElementSetting {
    return {
      visible: this.params.awsCredentialType === SupplyCredentials.ExplicitInProperty,
      label: "Endpoint url",
    };
  }

  // for aws
  getProfile(): ElementSetting {
    return {
      visible: this.params.awsCredentialType === SupplyCredentials.sharedCredentialsFile,
      label: "Profile name",
    };
  }

  getAwsCredentialType(): ElementSetting {
    return { visible: true };
  }
  getSsl(): ElementSetting {
    return { visible: false };
  }

  getResourceFilters(): ElementSetting {
    return { visible: true };
  }

  getTableResourceFilter(): ElementSetting {
    return { visible: true, label: "Table", defaultValue: "" };
  }

  getGroupResourceFilter(): ElementSetting {
    return { visible: true, label: "Group", defaultValue: "" };
  }

  getBucketResourceFilter(): ElementSetting {
    return { visible: true, label: "Bucket", defaultValue: "" };
  }

  accept(setting: ConnectionSetting): boolean {
    const { name, awsSetting, user, password } = setting;
    if (name === "" || awsSetting === undefined) {
      return false;
    }

    const { supplyCredentialType, profile } = awsSetting;

    if (supplyCredentialType === SupplyCredentials.ExplicitInProperty) {
      if (password === "" || user === "") {
        return false;
      }
    } else if (supplyCredentialType === SupplyCredentials.sharedCredentialsFile) {
      if (profile === "") {
        return false;
      }
    }

    return true;
  }
}
