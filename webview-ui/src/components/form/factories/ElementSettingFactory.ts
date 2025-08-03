import type {
  DBType,
  SQLServerAuthenticationType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Auth0ElementSetting } from "./Auth0ElementSetting";
import { AwsElementSetting } from "./AwsElementSetting";
import type { BaseElementSetting } from "./BaseElementSetting";
import { KeycloakElementSetting } from "./KeycloakElementSetting";
import { MqttElementSetting } from "./MqttElementSetting";
import {
  MysqlElementSetting,
  PostgresElementSetting,
  SQLServerElementSetting,
  SQLiteElementSetting,
} from "./RdsElementSetting";
import { RedisElementSetting } from "./RedisElementSetting";

export class ElementSettingFactory {
  public static create({
    dbType,
    awsCredentialType,
    sqlServerAuthenticationType,
  }: {
    dbType: DBType;
    awsCredentialType: string;
    sqlServerAuthenticationType: string;
  }): BaseElementSetting {
    switch (dbType) {
      case "Aws":
        return new AwsElementSetting({ awsCredentialType });
      case "Mqtt":
        return new MqttElementSetting();
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
      case "SQLite":
        return new SQLiteElementSetting();
      case "SQLServer":
        return new SQLServerElementSetting({
          sqlServerAuthenticationType: sqlServerAuthenticationType as SQLServerAuthenticationType,
        });
    }
  }
}
