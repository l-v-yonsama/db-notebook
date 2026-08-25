import { describe, expect, it } from "vitest";
import { buildDynamoDbObservedReadNotice } from "../../webview-ui/src/utilities/dynamoDbObservedReadNotice";

describe("buildDynamoDbObservedReadNotice", () => {
  it("実測前は実データを読む安全警告を表示する", () => {
    expect(buildDynamoDbObservedReadNotice(undefined)).toBe(
      '"Run Observed Read" reads and evaluates real items from the table above (first response only, up to 100 items evaluated), instead of only classifying the statement statically.',
    );
  });

  it("Run Observed Read実行後は結果と再実行時の注意へ切り替える", () => {
    expect(
      buildDynamoDbObservedReadNotice({
        source: "observedRead",
        returnedItemCount: 70,
        hasMorePages: true,
        bounded: true,
      }),
    ).toBe(
      '"Run Observed Read" completed: 70 items returned (single bounded response). DynamoDB returned a continuation marker, so unevaluated items may remain; later pages may or may not contain matches. Running it again starts a new observed read from the beginning and reads real items again.',
    );
  });

  it("0件でも継続可能な場合は後続範囲の一致を保証しない", () => {
    expect(
      buildDynamoDbObservedReadNotice({
        source: "observedRead",
        returnedItemCount: 0,
        hasMorePages: true,
        bounded: true,
      }),
    ).toBe(
      '"Run Observed Read" completed: 0 items returned (single bounded response). DynamoDB returned a continuation marker, so unevaluated items may remain; later pages may or may not contain matches. Running it again starts a new observed read from the beginning and reads real items again.',
    );
  });

  it("履歴由来の実測はRun Observed Read完了とは表現しない", () => {
    expect(
      buildDynamoDbObservedReadNotice({
        source: "sqlHistory",
        returnedItemCount: 1,
        bounded: false,
      }),
    ).toBe(
      "Observed read evidence is already available: 1 item returned. Running Run Observed Read starts a new read from the beginning and reads real items.",
    );
  });
});
