import { DBType, DbConnection, DbResource } from "@l-v-yonsama/multi-platform-database-drivers";
import { ResourceTreeProvider } from "../resource/ResourceTreeProvider";

export async function isRpcHistorySelection(
  selected: unknown,
  tree: ResourceTreeProvider
): Promise<boolean> {
  if (!(selected instanceof DbResource)) {
    return false;
  }
  const roots = await tree.getChildren();
  if (!roots) {
    return false;
  }
  let current: DbResource | undefined = selected;
  const visited = new Set<DbResource>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof DbConnection) {
      return roots.includes(current) && current.dbType === DBType.RPC;
    }
    const parent = await tree.getParent(current);
    if (!parent) {
      return false;
    }
    const siblings = parent instanceof DbConnection ? await tree.getChildren(parent) : parent.children;
    if (!siblings?.includes(current)) {
      return false;
    }
    current = parent;
  }
  return false;
}
