import { describe, expect, it } from "vitest";
import {
  buildDynamoDbBenchmarkSession,
  buildRdbBenchmarkSession,
} from "../../src/utilities/performanceTuningBenchmark";

describe("performance tuning benchmark summaries", () => {
  it("retains RDB samples and uses the median as the primary stable value", () => {
    const session = buildRdbBenchmarkSession({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      requestedRuns: 3,
      samples: [
        { run: 1, clientElapsedTimeMs: 130 },
        { run: 2, clientElapsedTimeMs: 78 },
        { run: 3, clientElapsedTimeMs: 81 },
      ],
    });
    expect(session.medianClientElapsedTimeMs).toBe(81);
    expect(session.averageClientElapsedTimeMs).toBeCloseTo(96.333);
    expect(session.minClientElapsedTimeMs).toBe(78);
    expect(session.maxClientElapsedTimeMs).toBe(130);
    expect(session.planCollectedBeforeBenchmark).toBe(true);
  });

  it("summarizes all five DynamoDB Observed Read samples", () => {
    const session = buildDynamoDbBenchmarkSession({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      requestedRuns: 5,
      samples: [9, 5, 7, 6, 8].map((clientElapsedTimeMs, index) => ({
        run: index + 1,
        clientElapsedTimeMs,
        completeness: "bounded" as const,
      })),
    });
    expect(session.completedRuns).toBe(5);
    expect(session.medianClientElapsedTimeMs).toBe(7);
    expect(session.mode).toBe("page");
    expect(session.completeness).toBe("bounded");
  });

  it("marks a mixed complete-result session as incomplete evidence", () => {
    const session = buildDynamoDbBenchmarkSession({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      requestedRuns: 3,
      mode: "completeResult",
      boundDescription: "Stopped at the 1,000-item safety limit.",
      samples: ["complete", "bounded", "complete"].map((completeness, index) => ({
        run: index + 1,
        clientElapsedTimeMs: 10 + index,
        completeness: completeness as "complete" | "bounded",
      })),
    });

    expect(session.mode).toBe("completeResult");
    expect(session.completeness).toBe("mixed");
    expect(session.boundDescription).toBe("Stopped at the 1,000-item safety limit.");
  });
});
