import type {
  PerformanceTuningAiQualityIssue,
  PerformanceTuningAiRecommendation,
} from "../shared/PerformanceTuningAiAnalysis";

// Produces a stable comparison form without changing quoted literal or
// identifier contents. Whitespace, comments, keyword/identifier casing and a
// trailing semicolon are irrelevant; characters inside SQL quotes are not.
export function normalizeSqlForRecommendationComparison(sql: string): string {
  const source = sql.trim().replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/, "");
  let result = "";
  let pendingSpace = false;
  let quote: "'" | '"' | "`" | "]" | undefined;
  let lineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n" || current === "\r") {
        lineComment = false;
        pendingSpace = true;
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        pendingSpace = true;
      }
      continue;
    }
    if (quote) {
      result += current;
      if (current === quote) {
        if (quote !== "]" && next === quote) {
          result += next;
          index += 1;
        } else {
          quote = undefined;
        }
      } else if (current === "\\" && quote !== "]" && next !== undefined) {
        result += next;
        index += 1;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      if (pendingSpace && result.length > 0 && !result.endsWith(" ")) {
        result += " ";
      }
      pendingSpace = false;
      quote = current;
      result += current;
      continue;
    }
    if (current === "[") {
      if (pendingSpace && result.length > 0 && !result.endsWith(" ")) {
        result += " ";
      }
      pendingSpace = false;
      quote = "]";
      result += current;
      continue;
    }
    if (/\s/.test(current)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && result.length > 0 && !result.endsWith(" ")) {
      result += " ";
    }
    pendingSpace = false;
    result += current.toLocaleLowerCase();
  }

  return result.trim().replace(/;+$/, "").trim();
}

export function excludeUnchangedSqlRecommendations(params: {
  currentSql: string;
  recommendations: PerformanceTuningAiRecommendation[];
}): {
  recommendations: PerformanceTuningAiRecommendation[];
  qualityIssues: PerformanceTuningAiQualityIssue[];
} {
  const current = normalizeSqlForRecommendationComparison(params.currentSql);
  const recommendations: PerformanceTuningAiRecommendation[] = [];
  const qualityIssues: PerformanceTuningAiQualityIssue[] = [];
  for (const recommendation of params.recommendations) {
    const suggestedSql = recommendation.suggestedSql;
    if (suggestedSql && normalizeSqlForRecommendationComparison(suggestedSql) === current) {
      qualityIssues.push({
        code: "SUGGESTED_SQL_MATCHES_CURRENT",
        recommendationTitle: recommendation.title,
        message:
          `The recommendation "${recommendation.title}" was excluded because its suggested SQL is equivalent to the SQL already being analyzed. ` +
          "The selected model may not have understood the current context; try Analyze with AI again using a different model.",
      });
      continue;
    }
    recommendations.push(recommendation);
  }
  return { recommendations, qualityIssues };
}
