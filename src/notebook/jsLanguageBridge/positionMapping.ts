// Pure coordinate translation between a real notebook cell and the virtual document that
// prefixes it with `PRELUDE_LINE_COUNT` prelude lines (see virtualDocumentProvider.ts).
// Kept free of any "vscode" import so it stays trivially unit-testable: callers convert to
// and from real vscode.Position/Range at the edges.
export interface PlainPosition {
  readonly line: number;
  readonly character: number;
}

export interface PlainRange {
  readonly start: PlainPosition;
  readonly end: PlainPosition;
}

export const toVirtualPosition = (
  preludeLineCount: number,
  real: PlainPosition
): PlainPosition => ({
  line: real.line + preludeLineCount,
  character: real.character,
});

// Returns undefined when the virtual position falls inside the prelude itself -- such a
// result has no sensible real-cell counterpart and callers should drop it rather than
// translate it into a nonsensical (possibly negative) position.
export const toRealPosition = (
  preludeLineCount: number,
  virtual: PlainPosition
): PlainPosition | undefined => {
  if (virtual.line < preludeLineCount) {
    return undefined;
  }
  return { line: virtual.line - preludeLineCount, character: virtual.character };
};

export const toRealRange = (
  preludeLineCount: number,
  virtualRange: PlainRange
): PlainRange | undefined => {
  const start = toRealPosition(preludeLineCount, virtualRange.start);
  const end = toRealPosition(preludeLineCount, virtualRange.end);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return { start, end };
};
