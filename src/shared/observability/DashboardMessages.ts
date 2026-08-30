import type {
  DashboardDisplayStatus,
  DashboardNotice,
  DashboardPanelPresentation,
  DashboardSelector,
  DashboardTabPresentation,
  DashboardTargetPresentation,
} from "./DashboardPresentation";

export type DashboardMessageEnvelope<T extends string, P> = {
  command: T;
  dashboardId: string;
  requestId: number;
  resourceKey: string;
  payload: P;
};

export type DashboardReadyMessage = {
  command: "ready";
  dashboardId: string;
};

export type DashboardClientMessage =
  | DashboardReadyMessage
  | DashboardMessageEnvelope<"refresh", Record<string, never>>
  | DashboardMessageEnvelope<"cancelRefresh", Record<string, never>>
  | DashboardMessageEnvelope<"selectViewOption", { selectorId: string; value: string }>
  | DashboardMessageEnvelope<"exportToNotebook", Record<string, never>>
  | DashboardMessageEnvelope<"close", Record<string, never>>;

export type DashboardInitializePayload<TPanel extends DashboardPanelPresentation> = {
  providerId: string;
  target: DashboardTargetPresentation;
  status: DashboardDisplayStatus;
  tabs: DashboardTabPresentation[];
  activeTabId: string;
  selectors: DashboardSelector[];
  panels: TPanel[];
  notices: DashboardNotice[];
};

export type DashboardHostMessage<
  TPanel extends DashboardPanelPresentation,
  TInitialize extends DashboardInitializePayload<TPanel> = DashboardInitializePayload<TPanel>
> =
  | DashboardMessageEnvelope<"initialize", TInitialize>
  | DashboardMessageEnvelope<"set-dashboard", TInitialize>
  | DashboardMessageEnvelope<"loading", { status: "loading"; preserveResults?: boolean }>
  | DashboardMessageEnvelope<"set-error", { message: string; notices?: DashboardNotice[] }>
  | DashboardMessageEnvelope<"refresh-cancelled", Record<string, never>>;
