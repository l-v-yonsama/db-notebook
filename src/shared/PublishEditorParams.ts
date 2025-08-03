export type PublishEditorParams = {
  subscriptionName: string;
  retain: boolean;
  qos: string;
  payload: string;
  langType: "plain" | "json" | "javascript";
  numOfPayloads: number;
  openInNotebook: boolean;
  inActiveNotebook?: boolean; // Optional, used for active notebook display
};
