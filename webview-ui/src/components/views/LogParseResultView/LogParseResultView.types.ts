import type { LogParseResultViewEventData } from "@/utilities/vscode";

export type InitializePayload = NonNullable<LogParseResultViewEventData["value"]["initialize"]>;

export type AddTabItemPayload = NonNullable<LogParseResultViewEventData["value"]["addTabItem"]>;
export type SearchResultPayload = NonNullable<LogParseResultViewEventData["value"]["searchResult"]>;
