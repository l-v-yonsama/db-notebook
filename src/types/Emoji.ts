export const EMOJI = {
  information: "ℹ️",
  warning: "⚠",
} as const;
export type EMOJI = (typeof EMOJI)[keyof typeof EMOJI];
