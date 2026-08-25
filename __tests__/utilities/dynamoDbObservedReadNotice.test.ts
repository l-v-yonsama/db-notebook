import { describe, expect, it } from "vitest";
import { buildDynamoDbObservedReadNotice } from "../../webview-ui/src/utilities/dynamoDbObservedReadNotice";

describe("buildDynamoDbObservedReadNotice", () => {
  it("実測前は実データを読む安全警告を表示する", () => {
    expect(buildDynamoDbObservedReadNotice(undefined)).toBe(
      '"Run Observed Read" reads real items from the table above (a single response, up to 100 items), instead of only classifying the statement statically.',
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
      '"Run Observed Read" completed: 70 items returned (single bounded response; more pages available). Running it again will read real items from the table again.',
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
      "Observed read evidence is already available: 1 item returned. Running it again will read real items from the table again.",
    );
  });
});
