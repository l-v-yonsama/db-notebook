export type UniqKey = {
  kind: 'uniq';
  name: string;
};
export type PrimaryKey = {
  kind: 'primary';
  names: string[];
};
export type CompareKey = UniqKey | PrimaryKey;
