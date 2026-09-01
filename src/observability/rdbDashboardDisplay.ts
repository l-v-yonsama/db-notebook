const SQLITE_DASHBOARD_PROVIDER_ID = "rdb.sqlite.database";
const SQLITE_PATH_DISPLAY_LENGTH = 80;

function sqliteFileName(databasePath: string): string {
  const segments = databasePath.split(/[\\/]/);
  return segments.at(-1) || databasePath;
}

function trailingText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `…${value.slice(-(maxLength - 1))}`;
}

export type RdbDashboardDisplayLabels = {
  displayName: string;
  scopeLabel: string;
  panelTitleName: string;
};

export function rdbDashboardDisplayLabels(
  providerId: string,
  databaseName: string
): RdbDashboardDisplayLabels {
  if (providerId !== SQLITE_DASHBOARD_PROVIDER_ID) {
    return {
      displayName: databaseName,
      scopeLabel: `Database ${databaseName}`,
      panelTitleName: databaseName,
    };
  }

  const fileName = sqliteFileName(databaseName);
  return {
    displayName: trailingText(databaseName, SQLITE_PATH_DISPLAY_LENGTH),
    scopeLabel: fileName,
    panelTitleName: fileName,
  };
}

export function compactRdbDashboardScope(params: {
  providerId: string;
  databaseName: string;
  scopeKind: string;
  label: string;
}): { label: string; fullLabel?: string } {
  if (
    params.providerId !== SQLITE_DASHBOARD_PROVIDER_ID ||
    params.scopeKind !== "attached-database"
  ) {
    return { label: params.label };
  }
  const compactLabel = rdbDashboardDisplayLabels(params.providerId, params.databaseName).scopeLabel;
  return {
    label: compactLabel,
    ...(params.label === compactLabel ? {} : { fullLabel: params.label }),
  };
}
