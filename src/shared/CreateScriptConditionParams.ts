export type CreateScriptConditionParams = {
  assignSchemaName: boolean;
  onlyNotNullColumns: boolean;
  withComments: boolean;
  compactSql: boolean;
  preview: boolean;
  openInNotebook: boolean;
  lang: "sql" | "javascript";
};
