export type ToWebviewMessageEventType<T = any> = {
  command: string;
  componentName?: string;
  value?: T;
};
