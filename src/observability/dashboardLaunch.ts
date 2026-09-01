import type {
  DashboardLaunchCapability,
  DbResource,
} from "@l-v-yonsama/multi-platform-database-drivers";

const DASHBOARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function getDashboardLaunchCapabilities(
  resource: Pick<DbResource, "capabilities">
): readonly DashboardLaunchCapability[] {
  return resource.capabilities?.dashboards ?? [];
}

export function appendDashboardContextValues(
  contextValue: string,
  resource: Pick<DbResource, "capabilities">
): string {
  const dashboardIds = new Set<string>();
  for (const capability of getDashboardLaunchCapabilities(resource)) {
    if (DASHBOARD_ID_PATTERN.test(capability.dashboardId)) {
      dashboardIds.add(capability.dashboardId);
    }
  }
  for (const dashboardId of dashboardIds) {
    contextValue += `,dashboard:${dashboardId}`;
  }
  return contextValue;
}

export function stampDashboardConnectionName(
  resource: Pick<DbResource, "capabilities" | "children" | "meta">,
  connectionName: string
): void {
  if (getDashboardLaunchCapabilities(resource as Pick<DbResource, "capabilities">).length > 0) {
    resource.meta = { ...(resource.meta ?? {}), conName: connectionName };
  }
  for (const child of resource.children) {
    stampDashboardConnectionName(child, connectionName);
  }
}
