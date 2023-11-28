import type { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { MysqlElementSetting, PostgresElementSetting } from "./RdsElementSetting";
import { AwsElementSetting } from "./AwsElementSetting";
import { RedisElementSetting } from "./RedisElementSetting";
import { KeycloakElementSetting } from "./KeycloakElementSetting";
import type { BaseElementSetting } from "./BaseElementSetting";
import { Auth0ElementSetting } from "./Auth0ElementSetting";

export class ElementSettingFactory {
  public static create({
    dbType,
    awsCredentialType,
  }: {
    dbType: DBType;
    awsCredentialType: string;
  }): BaseElementSetting {
    switch (dbType) {
      case "Aws":
        return new AwsElementSetting({ awsCredentialType });
      case "Redis":
        return new RedisElementSetting();
      case "Auth0":
        return new Auth0ElementSetting();
      case "Keycloak":
        return new KeycloakElementSetting();
      case "MySQL":
        return new MysqlElementSetting();
      case "Postgres":
        return new PostgresElementSetting();
    }
  }
}
