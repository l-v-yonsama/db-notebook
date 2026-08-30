import {
  CloudWatchLogsMetricServiceAdapter,
  SesMetricServiceAdapter,
  SqsMetricServiceAdapter,
  type CloudWatchMetricPanelsResult,
  type ResolvedMetricDashboard,
  type ResolvedMetricPanel,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";
import {
  CLOUDWATCH_TIME_RANGE_SELECTOR_ID,
  filterCollectableCloudWatchPanels,
  toCloudWatchInitializePayload,
  toCloudWatchMetricsPayload,
} from "../../src/observability/cloudWatchDashboardPresenter";

describe("CloudWatch dashboard presenter", () => {
  it("converts an adapter dashboard without leaking source attributes", async () => {
    const adapter = new SqsMetricServiceAdapter();
    const target = await adapter.resolveTarget({
      resourceKey: "runtime-resource-key",
      displayName: "orders.fifo",
      region: "ap-northeast-1",
      attributes: { FifoQueue: true },
    });
    const dashboard = await adapter.resolveDashboard(target, {});
    const payload = toCloudWatchInitializePayload({
      dashboard,
      tab: dashboard.tabs[0],
      range: "1h",
      region: target.endpoint.region,
      environmentLabel: "Production",
    });

    expect(payload.providerId).toBe("aws.sqs.queue");
    expect(payload.target.sourceLabel).toBe("CloudWatch / AWS/SQS / ap-northeast-1");
    expect(payload.selectors[0]).toMatchObject({
      id: CLOUDWATCH_TIME_RANGE_SELECTOR_ID,
      value: "1h",
    });
    expect(payload.tabs).toEqual([{ id: "overview", title: "Overview" }]);
    expect(payload.panels.some((panel) => panel.id === "fifo")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("FifoQueue");
  });

  it("shows S3 request configuration only on the request tab and skips its metric calls", () => {
    const panel = (id: string, prerequisiteKey?: string): ResolvedMetricPanel => ({
      id,
      title: id,
      purpose: "configuration",
      visualization: "line",
      emission: "opt-in",
      scope: { kind: "configured-filter", label: "orders" },
      cost: { publication: "service-option", read: "get-metric-data" },
      queries: [],
      prerequisiteKey,
    });
    const storagePanel = panel("storage");
    const requestPanel = panel("requests", "s3-request-metrics");
    const dashboard: ResolvedMetricDashboard = {
      providerId: "aws.s3.bucket",
      variant: "bucket",
      target: {
        resourceKey: "runtime-resource-key",
        displayName: "orders",
        scopeLabel: "Bucket orders",
      },
      tabs: [
        {
          id: "storage",
          title: "Storage (daily)",
          defaultRange: "30d",
          autoRefreshAllowed: false,
          selectors: [],
          panels: [storagePanel],
        },
        {
          id: "requests",
          title: "Requests",
          defaultRange: "1h",
          autoRefreshAllowed: true,
          selectors: [],
          panels: [requestPanel],
        },
      ],
      prerequisites: {
        "s3-request-metrics": {
          status: "not-configured",
          enablement: {
            title: "S3 request metrics are not enabled",
            steps: ["Create a metrics configuration."],
            costNotice: "Additional charges can apply.",
          },
        },
      },
    };
    const storagePayload = toCloudWatchInitializePayload({
      dashboard,
      tab: dashboard.tabs[0],
      range: "30d",
      region: "us-west-2",
    });
    const requestPayload = toCloudWatchInitializePayload({
      dashboard,
      tab: dashboard.tabs[1],
      range: "1h",
      region: "us-west-2",
    });

    expect(storagePayload.notices).toEqual([]);
    expect(storagePayload.autoRefresh).toEqual({ allowed: false, intervalMinutes: 0 });
    expect(requestPayload.notices[0].title).toBe("S3 request metrics are not enabled");
    expect(requestPayload.autoRefresh).toEqual({ allowed: true, intervalMinutes: 0 });
    expect(requestPayload.panels[0].prerequisite?.status).toBe("not-configured");
    expect(
      filterCollectableCloudWatchPanels(dashboard.tabs[1].panels, dashboard.prerequisites)
    ).toEqual([]);
    expect(
      filterCollectableCloudWatchPanels(dashboard.tabs[0].panels, dashboard.prerequisites)
    ).toEqual([storagePanel]);
  });

  it("preserves generic collapsed panel metadata for the webview", async () => {
    const adapter = new CloudWatchLogsMetricServiceAdapter();
    const target = await adapter.resolveTarget({
      resourceKey: "runtime-resource-key",
      displayName: "/aws/lambda/orders",
      region: "ap-northeast-1",
    });
    const dashboard = await adapter.resolveDashboard(target, {});
    const payload = toCloudWatchInitializePayload({
      dashboard,
      tab: dashboard.tabs[0],
      range: "1h",
      region: target.endpoint.region,
    });

    expect(
      payload.panels.find((panel) => panel.id === "subscription-delivery")?.collapsedByDefault
    ).toBe(true);
  });

  it("presents SES as an account-region dashboard with direct reputation thresholds", async () => {
    const adapter = new SesMetricServiceAdapter({
      getAvailability: () =>
        ({ discoverMetricNames: async () => ["Open"] }) as never,
    });
    const target = await adapter.resolveTarget({
      resourceKey: "runtime-resource-key",
      displayName: "SES",
      region: "ap-northeast-1",
    });
    const dashboard = await adapter.resolveDashboard(target, {});
    const payload = toCloudWatchInitializePayload({
      dashboard,
      tab: dashboard.tabs[0],
      range: "3d",
      region: target.endpoint.region,
    });
    const reputation = payload.panels.find((panel) => panel.id === "reputation")!;

    expect(payload).toMatchObject({
      providerId: "aws.ses.account-region",
      variant: "account-region",
      target: {
        displayName: "SES account",
        sourceLabel: "CloudWatch / AWS/SES / ap-northeast-1",
        scope: {
          kind: "account-region",
          label: "SES account in ap-northeast-1",
        },
      },
    });
    expect(reputation.thresholds).toEqual([
      { value: 0.05, label: "Bounce rate 5%", severity: "warn" },
      { value: 0.001, label: "Complaint rate 0.1%", severity: "warn" },
    ]);
    expect(reputation.queries.map((query) => query.metricName)).toEqual([
      "Reputation.BounceRate",
      "Reputation.ComplaintRate",
    ]);
  });

  it("preserves observed zero and missing null while mapping mixed failure to partial", () => {
    const result: CloudWatchMetricPanelsResult = {
      startTime: "2026-08-29T00:00:00.000Z",
      endTime: "2026-08-29T01:00:00.000Z",
      periodSeconds: 60,
      panels: [
        {
          panelId: "backlog",
          periodSeconds: 60,
          series: [
            {
              id: "visible",
              metricName: "Visible",
              statistic: "Maximum",
              label: "Visible",
              unit: "count",
              dimensions: [],
              messages: [],
              status: "complete",
              points: [
                { timestamp: "2026-08-29T00:00:00.000Z", value: 0 },
                { timestamp: "2026-08-29T00:01:00.000Z", value: null },
              ],
            },
            {
              id: "inflight",
              metricName: "InFlight",
              statistic: "Maximum",
              label: "In flight",
              unit: "count",
              dimensions: [],
              messages: [{ code: "AccessDenied", value: "cloudwatch:GetMetricData denied" }],
              status: "forbidden",
              points: [],
            },
          ],
        },
      ],
    };

    const payload = toCloudWatchMetricsPayload(result);
    expect(payload.status).toBe("partial");
    expect(payload.panelSeries[0].series[0].points).toEqual([
      { x: "2026-08-29T00:00:00.000Z", y: 0 },
      { x: "2026-08-29T00:01:00.000Z", y: null },
    ]);
    expect(payload.panelSeries[0].series[1].diagnostics).toEqual([
      { code: "AccessDenied", message: "cloudwatch:GetMetricData denied" },
    ]);
  });
});
