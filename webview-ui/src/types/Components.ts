export type DropdownItem = {
  value: string | number;
  label: string;
  meta?: {
    [key: string]: any;
  };
};

type SecondaryItemDivider = {
  kind: "divider";
};

export type SecondaryItemSelection<T = any> = {
  kind: "selection";
  label: string;
  icon?: string;
  value: T;
  disabled?: boolean;
  when?: () => boolean;
};

export type SecondaryItem<T = any> = SecondaryItemDivider | SecondaryItemSelection<T>;
