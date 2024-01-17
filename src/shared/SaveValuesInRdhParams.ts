export type SaveValuesInRdhParams = {
  insertList: EditRowInsertValues[];
  updateList: EditRowUpdateValues[];
  deleteList: EditRowDeleteValues[];
  ok: boolean;
  message: string;
};

export type EditRowInsertValues = {
  values: EditRowValuesParam;
};

export type EditRowUpdateValues = {
  values: EditRowValuesParam;
  conditions: EditRowConditionParam;
};

export type EditRowDeleteValues = {
  conditions: EditRowConditionParam;
};

export type EditRowValuesParam = {
  [key: string]: any;
};

export type EditRowConditionParam = {
  [key: string]: any;
};
