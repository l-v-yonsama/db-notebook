export type DynamoQueryFilter = {
  name: string;
  value: string;
  operator: string;
};
export type DynamoDBConditionParams = {
  target: string;
  pkValue: string;
  skValue: string;
  skOpe: string;
  limit: number;
  preview: boolean;
  sortDesc: boolean;
  filters: DynamoQueryFilter[];
};
