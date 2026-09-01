import type {
  DynamoDbBenchmarkSample,
  DynamoDbBenchmarkSession,
  PerformanceTuningBenchmarkSample,
  PerformanceTuningBenchmarkSession,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type BenchmarkRunCount = 3 | 5;

function summarize(samples: Array<{ clientElapsedTimeMs: number }>) {
  if (samples.length === 0) {
    throw new Error("A benchmark session requires at least one completed sample.");
  }
  const values = samples.map((sample) => sample.clientElapsedTimeMs).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
  return {
    medianClientElapsedTimeMs: median,
    averageClientElapsedTimeMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    minClientElapsedTimeMs: values[0],
    maxClientElapsedTimeMs: values[values.length - 1],
  };
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function buildRdbBenchmarkSession(params: {
  startedAt: string;
  completedAt: string;
  requestedRuns: BenchmarkRunCount;
  samples: PerformanceTuningBenchmarkSample[];
}): PerformanceTuningBenchmarkSession {
  return {
    ...params,
    completedRuns: params.samples.length,
    ...summarize(params.samples),
    planCollectedBeforeBenchmark: true,
    source: "performanceTuningBenchmark",
  };
}

export function buildDynamoDbBenchmarkSession(params: {
  startedAt: string;
  completedAt: string;
  requestedRuns: BenchmarkRunCount;
  samples: DynamoDbBenchmarkSample[];
  mode?: "page" | "completeResult";
  boundDescription?: string;
}): DynamoDbBenchmarkSession {
  const consumedReadCapacity = params.samples.flatMap((sample) => {
    const value = sample.consumedCapacity?.readCapacityUnits ?? sample.consumedCapacity?.capacityUnits;
    return value === undefined ? [] : [value];
  });
  const returnedCounts = params.samples.flatMap((sample) =>
    sample.returnedItemCount === undefined ? [] : [sample.returnedItemCount]
  );
  const evaluatedCounts = params.samples.flatMap((sample) =>
    sample.evaluatedItemCount === undefined ? [] : [sample.evaluatedItemCount]
  );
  const completenessValues = [...new Set(params.samples.map((sample) => sample.completeness))];
  const completeness = completenessValues.length === 1 ? completenessValues[0] : "mixed";
  return {
    ...params,
    completedRuns: params.samples.length,
    ...summarize(params.samples),
    medianConsumedReadCapacityUnits: median(consumedReadCapacity),
    averageConsumedReadCapacityUnits: consumedReadCapacity.length > 0
      ? consumedReadCapacity.reduce((sum, value) => sum + value, 0) / consumedReadCapacity.length
      : undefined,
    medianReturnedItemCount: median(returnedCounts),
    medianEvaluatedItemCount: median(evaluatedCounts),
    mode: params.mode ?? "page",
    completeness,
    ...(completeness === "bounded" || completeness === "mixed"
      ? {
          boundDescription:
            params.boundDescription ??
            "At least one benchmark run stopped before the full result was evaluated.",
        }
      : {}),
    source: "performanceTuningBenchmark",
  };
}
