import { describe, expect, it } from "vitest";
import {
  toRealPosition,
  toRealRange,
  toVirtualPosition,
} from "../../../src/notebook/jsLanguageBridge/positionMapping";

describe("jsLanguageBridge/positionMapping", () => {
  const preludeLineCount = 10;

  it("toVirtualPosition: 行数分だけlineをオフセットし、characterは変えない", () => {
    expect(toVirtualPosition(preludeLineCount, { line: 0, character: 3 })).toEqual({
      line: 10,
      character: 3,
    });
    expect(toVirtualPosition(preludeLineCount, { line: 5, character: 0 })).toEqual({
      line: 15,
      character: 0,
    });
  });

  it("toRealPosition: prelude領域より後ろならオフセットを差し引く", () => {
    expect(toRealPosition(preludeLineCount, { line: 10, character: 3 })).toEqual({
      line: 0,
      character: 3,
    });
    expect(toRealPosition(preludeLineCount, { line: 12, character: 0 })).toEqual({
      line: 2,
      character: 0,
    });
  });

  it("toRealPosition: 境界値ちょうど(preludeLineCount)はセル本文の先頭行になる", () => {
    expect(toRealPosition(preludeLineCount, { line: preludeLineCount, character: 0 })).toEqual({
      line: 0,
      character: 0,
    });
  });

  it("toRealPosition: prelude領域内(preludeLineCount未満)はundefinedを返す", () => {
    expect(
      toRealPosition(preludeLineCount, { line: preludeLineCount - 1, character: 0 })
    ).toBeUndefined();
    expect(toRealPosition(preludeLineCount, { line: 0, character: 0 })).toBeUndefined();
  });

  it("toRealPosition/toVirtualPositionは往復して元の位置に戻る", () => {
    const real = { line: 4, character: 7 };
    expect(toRealPosition(preludeLineCount, toVirtualPosition(preludeLineCount, real))).toEqual(
      real
    );
  });

  it("toRealRange: startとendを個別に変換する", () => {
    expect(
      toRealRange(preludeLineCount, {
        start: { line: 10, character: 2 },
        end: { line: 11, character: 5 },
      })
    ).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 1, character: 5 },
    });
  });

  it("toRealRange: startかendのどちらかがprelude領域に入るなら範囲全体を破棄する", () => {
    expect(
      toRealRange(preludeLineCount, {
        start: { line: 0, character: 0 },
        end: { line: 11, character: 0 },
      })
    ).toBeUndefined();
  });
});
