import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

export abstract class BaseElementSetting {
  abstract getUser(): ElementSetting;

  abstract getPassword(): ElementSetting;

  abstract getTimezone(): ElementSetting;

  abstract getDatabase(): ElementSetting;

  abstract getIamClientId(): ElementSetting;

  abstract getHost(): ElementSetting;

  abstract getPort(): ElementSetting<number>;

  abstract getUrl(): ElementSetting;

  abstract getProfile(): ElementSetting;

  abstract getAwsCredentialType(): ElementSetting;

  abstract accept(setting: ConnectionSetting): boolean;
}
export type ElementSetting<T extends string | number = string> = {
  visible: boolean;
  placeholder?: string;
  label?: string;
  defaultValue?: T;
};
