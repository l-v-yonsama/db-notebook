export type DropdownItem = {
  value: string | number;
  label: string;
};

type SecondaryItemDivider = {
  kind: "divider";
};

type SecondaryItemSelection<T = any> = {
  kind: "selection";
  label: string;
  icon?: string;
  value: T;
  disabled?: boolean;
};

export type SecondaryItem<T = any> = SecondaryItemDivider | SecondaryItemSelection<T>;
