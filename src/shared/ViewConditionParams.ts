import type { TopLevelCondition } from "./ViewCondition";

export type ViewConditionParams = {
  conditions: TopLevelCondition;
  specfyCondition: boolean;
  limit: number;
  editable: boolean;
  preview: boolean;
  openInNotebook: boolean;
  inActiveNotebook?: boolean; // Optional, used for active notebook display
};
