import type { LogParseSettingPanelEventData } from "@/utilities/vscode";

export type InitializePayload = NonNullable<LogParseSettingPanelEventData["value"]["initialize"]>;

export type ResetConfigPayload = NonNullable<
  LogParseSettingPanelEventData["value"]["reset-config"]
>;

export type ResetConfigFileAndItemsPayload = NonNullable<
  LogParseSettingPanelEventData["value"]["reset-config-file-and-items"]
>;
