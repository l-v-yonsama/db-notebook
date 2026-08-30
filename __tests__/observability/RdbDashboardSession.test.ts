import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RdbDashboardSession } from "../../src/observability/RdbDashboardSession";
import { createRDSDriver, removeDriver } from "../../src/utilities/driverResolver";

vi.mock("../../src/utilities/driverResolver", () => ({
  createRDSDriver: vi.fn(),
  removeDriver: vi.fn(),
}));

const target = {
  resourceKey: "runtime",
  databaseName: "app",
  dbType: DBType.Postgres,
};

const dashboard = {
  providerId: "rdb.postgres.database",
  variant: "postgres-16",
  definitionVersion: 1,
  target: {
    resourceKey: "runtime",
    displayName: "app",
    sourceLabel: "PostgreSQL",
    scope: { kind: "database", label: "Database app" },
  },
  serverVersion: "16",
  samplePolicy: {
    defaultIntervalMs: 10_000,
    allowedIntervalMs: [10_000],
    maxPointsPerSeries: 10,
    maxVisibleSeriesPerPanel: 10,
    defaultTopN: 5,
    maxPayloadBytes: 100_000,
    queryTimeoutMs: 3_000,
    hiddenDisconnectDelayMs: 30_000,
  },
  metrics: [
    {
      id: "active",
      label: "Active",
      unit: "count",
      scope: { kind: "database", label: "Database app" },
      measurement: { kind: "gauge" as const },
    },
  ],
  tabs: [],
  capabilities: [],
  notices: [],
};

function raw(sequence: number) {
  return {
    sampleSessionId: "ignored",
    definitionVersion: 1,
    sequence,
    collectionStartedAt: "2026-08-30T00:00:00.000Z",
    collectionEndedAt: "2026-08-30T00:00:00.001Z",
    epochs: [],
    observations: [
      {
        metricId: "active",
        observedAt: "2026-08-30T00:00:00.000Z",
        value: sequence + 1,
        status: "ok" as const,
      },
    ],
    diagnostics: [],
  };
}

describe("RdbDashboardSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens a dedicated database connection, collects an initial snapshot, and removes it", async () => {
    let sampleSessionId = "";
    const selection = { operation: "read" };
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkRdbDashboardAvailability: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          providerId: "rdb.postgres.database",
          variant: "postgres-16",
          serverVersion: "16",
          sections: [],
        },
      }),
      resolveRdbDashboard: vi.fn().mockResolvedValue({ ok: true, result: dashboard }),
      collectRdbDashboardSample: vi.fn().mockImplementation(async (request) => {
        sampleSessionId = request.sampleSessionId;
        expect(request.selection).toEqual(selection);
        return { ok: true, result: { ...raw(request.sequence), sampleSessionId } };
      }),
    };
    vi.mocked(createRDSDriver).mockResolvedValue(driver as never);
    const session = new RdbDashboardSession();
    const opened = await session.open(
      { dbType: DBType.Postgres, name: "postgres", database: "postgres", queryTimeoutMs: 99_000 },
      target,
      selection,
      new AbortController().signal
    );

    expect(createRDSDriver).toHaveBeenCalledWith(
      expect.objectContaining({ database: "app", queryTimeoutMs: 3_000 }),
      true
    );
    expect(vi.mocked(createRDSDriver).mock.calls[0][0]).not.toHaveProperty("readOnly");
    expect(opened.accumulated.series[0].points[0].value).toBe(1);
    expect(sampleSessionId).not.toBe("");
    await session.close();
    await session.close();
    expect(driver.disconnect).toHaveBeenCalledOnce();
    expect(removeDriver).toHaveBeenCalledOnce();
  });

  it("forces SQLite observer sessions to be read-only so sql.js does not write back on close", async () => {
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkRdbDashboardAvailability: vi.fn().mockResolvedValue({ ok: true, result: {} }),
      resolveRdbDashboard: vi.fn().mockResolvedValue({ ok: true, result: dashboard }),
      collectRdbDashboardSample: vi.fn().mockImplementation(async (request) => ({
        ok: true,
        result: { ...raw(request.sequence), sampleSessionId: request.sampleSessionId },
      })),
    };
    vi.mocked(createRDSDriver).mockResolvedValue(driver as never);
    const session = new RdbDashboardSession();

    await session.open(
      { dbType: DBType.SQLite, name: "sqlite", database: "/tmp/app.sqlite" },
      { ...target, dbType: DBType.SQLite },
      {},
      new AbortController().signal
    );

    expect(createRDSDriver).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }), true);
    await session.close();
  });

  it("rejects a second sample while one is in flight on the observer connection", async () => {
    let resolveSecond: ((value: unknown) => void) | undefined;
    const driver = {
      connect: vi.fn().mockResolvedValue(""),
      disconnect: vi.fn().mockResolvedValue(undefined),
      checkRdbDashboardAvailability: vi.fn().mockResolvedValue({ ok: true, result: {} }),
      resolveRdbDashboard: vi.fn().mockResolvedValue({ ok: true, result: dashboard }),
      collectRdbDashboardSample: vi
        .fn()
        .mockImplementationOnce(async (request) => ({
          ok: true,
          result: { ...raw(request.sequence), sampleSessionId: request.sampleSessionId },
        }))
        .mockImplementationOnce(
          (request) =>
            new Promise((resolve) => {
              resolveSecond = resolve;
              void request;
            })
        ),
    };
    vi.mocked(createRDSDriver).mockResolvedValue(driver as never);
    const session = new RdbDashboardSession();
    await session.open(
      { dbType: DBType.Postgres, name: "postgres" },
      target,
      {},
      new AbortController().signal
    );

    const first = session.collectOnce(new AbortController().signal);
    await expect(session.collectOnce(new AbortController().signal)).rejects.toThrow(
      "already being collected"
    );
    const request = driver.collectRdbDashboardSample.mock.calls[1][0];
    resolveSecond?.({
      ok: true,
      result: { ...raw(request.sequence), sampleSessionId: request.sampleSessionId },
    });
    await first;
    await session.close();
  });

  it("removes the driver even when disconnect fails", async () => {
    const driver = {
      connect: vi.fn().mockResolvedValue("connection detail"),
      disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed")),
    };
    vi.mocked(createRDSDriver).mockResolvedValue(driver as never);
    const session = new RdbDashboardSession();
    await expect(
      session.open(
        { dbType: DBType.Postgres, name: "postgres" },
        target,
        {},
        new AbortController().signal
      )
    ).rejects.toThrow("observer connection could not be opened");
    expect(removeDriver).toHaveBeenCalledWith(driver);
  });
});
