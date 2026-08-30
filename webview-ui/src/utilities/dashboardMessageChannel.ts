import type { DashboardMessageEnvelope } from "@/utilities/vscode";
import { vscode } from "@/utilities/vscode";
import { ref } from "vue";

export type DashboardEnvelopeAcceptance = {
  accepted: boolean;
  targetChanged: boolean;
};

export function useDashboardMessageChannel(options: {
  dashboardIds: ReadonlySet<string>;
  initialDashboardId: string;
}) {
  const currentRequestId = ref(-1);
  const currentResourceKey = ref("");
  const currentDashboardId = ref(options.initialDashboardId);

  function acceptEnvelope(
    message: DashboardMessageEnvelope<string, unknown>
  ): DashboardEnvelopeAcceptance {
    if (!options.dashboardIds.has(message.dashboardId)) {
      return { accepted: false, targetChanged: false };
    }
    if (message.command === "loading") {
      if (message.requestId < currentRequestId.value) {
        return { accepted: false, targetChanged: false };
      }
      const targetChanged =
        message.resourceKey !== currentResourceKey.value ||
        message.dashboardId !== currentDashboardId.value;
      currentRequestId.value = message.requestId;
      currentResourceKey.value = message.resourceKey;
      currentDashboardId.value = message.dashboardId;
      return { accepted: true, targetChanged };
    }
    return {
      accepted:
        message.requestId === currentRequestId.value &&
        message.resourceKey === currentResourceKey.value &&
        message.dashboardId === currentDashboardId.value,
      targetChanged: false,
    };
  }

  function post<T extends string, P>(command: T, payload: P): void {
    if (!currentResourceKey.value) {
      return;
    }
    const message: DashboardMessageEnvelope<T, P> = {
      command,
      dashboardId: currentDashboardId.value,
      requestId: currentRequestId.value,
      resourceKey: currentResourceKey.value,
      payload,
    };
    vscode.postMessage(message);
  }

  return {
    acceptEnvelope,
    post,
  };
}
