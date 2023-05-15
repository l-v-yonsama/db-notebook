import type { ModeType } from "@/utilities/vscode";

export type OperateItemParams = {
  mode: ModeType;
  item: any;
};

export type ActionParams<T = any, U = any> = {
  command: T;
  params: U;
};

export type RowOperationActionParams = ActionParams<"row-operation", OperateItemParams>;
