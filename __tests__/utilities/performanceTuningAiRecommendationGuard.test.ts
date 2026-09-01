import { describe, expect, it } from "vitest";
import {
  excludeUnchangedSqlRecommendations,
  normalizeSqlForRecommendationComparison,
} from "../../src/utilities/performanceTuningAiRecommendationGuard";

describe("performance tuning AI recommendation guard", () => {
  it("normalizes formatting/comments/casing outside quoted values", () => {
    expect(normalizeSqlForRecommendationComparison("SELECT *\nFROM t -- note\nWHERE c = 'WEB';"))
      .toBe(normalizeSqlForRecommendationComparison("select * from t where c = 'WEB'"));
  });

  it("does not treat case-sensitive literal changes as the same SQL", () => {
    expect(normalizeSqlForRecommendationComparison("select * from t where c = 'WEB'"))
      .not.toBe(normalizeSqlForRecommendationComparison("select * from t where c = 'web'"));
  });

  it("excludes an unchanged suggested query and recommends another model", () => {
    const result = excludeUnchangedSqlRecommendations({
      currentSql: "SELECT * FROM orders WHERE created_at >= '2025-12-01';",
      recommendations: [
        {
          title: "Rewrite the filter",
          detail: "Already done",
          rationale: "Already done",
          suggestedQuery: "select *\nfrom orders where created_at >= '2025-12-01'",
        },
        {
          title: "Review an index",
          detail: "Different action",
          rationale: "Different action",
          suggestedQuery: "CREATE INDEX idx_orders_created_at ON orders(created_at);",
        },
      ],
    });

    expect(result.recommendations.map((item) => item.title)).toEqual(["Review an index"]);
    expect(result.qualityIssues).toHaveLength(1);
    expect(result.qualityIssues[0].code).toBe("SUGGESTED_QUERY_MATCHES_CURRENT");
    expect(result.qualityIssues[0].message).toContain("different model");
  });
});
