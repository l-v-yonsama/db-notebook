import type { DashboardTimeSeries } from "@/utilities/vscode";

export function latestDashboardValue(series: DashboardTimeSeries): number | null {
  return series.points.at(-1)?.y ?? null;
}

export function dashboardSeriesDelta(series: DashboardTimeSeries): number | undefined {
  const latest = latestDashboardValue(series);
  const previous = [...series.points]
    .slice(0, -1)
    .reverse()
    .find((point) => point.y !== null)?.y;
  return latest === null || previous === undefined || previous === null
    ? undefined
    : latest - previous;
}

export function dashboardSelfObservationLabel(series: DashboardTimeSeries): string | undefined {
  switch (series.selfObservation) {
    case "included":
      return "Observer activity is included";
    case "unknown":
      return "Observer impact is unknown";
    case "excluded":
      return "Observer activity is excluded";
  }
}

export function dashboardObserverCaveat(series: DashboardTimeSeries[]): string | undefined {
  const included = series.filter((item) => item.selfObservation === "included");
  const unknown = series.filter((item) => item.selfObservation === "unknown");
  const parts: string[] = [];
  if (included.length) {
    parts.push(`included for ${included.map((item) => item.label).join(", ")}`);
  }
  if (unknown.length) {
    parts.push(`unknown for ${unknown.map((item) => item.label).join(", ")}`);
  }
  return parts.length ? `Observer impact is ${parts.join("; ")}.` : undefined;
}

export function isDashboardSeriesWarmup(series: DashboardTimeSeries[]): boolean {
  return (
    series.length > 0 &&
    series.every((item) => item.points.every((point) => point.y === null)) &&
    series.some((item) => item.diagnostics?.some((diagnostic) => diagnostic.code === "warming-up"))
  );
}

export function dashboardSeriesColor(seriesId: string, alpha?: number): string {
  let hash = 0x811c9dc5;
  for (const character of seriesId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  const unsignedHash = hash >>> 0;
  const hue = unsignedHash % 360;
  const saturation = 62 + ((unsignedHash >>> 9) % 12);
  const lightness = 48 + ((unsignedHash >>> 17) % 10);
  return alpha === undefined
    ? `hsl(${hue}, ${saturation}%, ${lightness}%)`
    : `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}
