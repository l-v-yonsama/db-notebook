export type Chat2QueryConditionParams = {
  translateResponse: boolean;
  withTableDefinition: boolean;
  withSampleData: boolean;
  languageModelId: string;
  selectedTableNames: string[];
  queryContent: string;
  preview: boolean;
  commentType: "none" | "inline" | "before";
};
