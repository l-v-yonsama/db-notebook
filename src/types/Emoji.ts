export const EMOJI = {
  warning: "⚠",
} as const;
export type EMOJI = (typeof EMOJI)[keyof typeof EMOJI];
