/**
 * Keeps the exact UTC evidence and appends a deliberately compact local-time
 * hint. When UTC and local calendar dates differ, include MM-DD so crossing
 * midnight is visible; otherwise HH:mm is enough.
 */
export function formatUtcWithLocal(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.month}-${parts.day}`;
  const utcDate = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  const localHint = localDate === utcDate ? localTime : `${localDate} ${localTime}`;
  return `${value} (local ${localHint})`;
}
