export type CodeResolver = {
  connectionName: string;
  items: CodeItem[];
};

export type CodeItem = {
  title: string;
  description: string;
  resource: ApplicableResources;
  details: CodeItemDetail[];
};

export type ApplicableResources = {
  table?: {
    regex: boolean;
    pattern: string;
  };
  column: {
    regex: boolean;
    pattern: string;
  };
};

export type CodeItemDetail = {
  code: string;
  label: string;
};
