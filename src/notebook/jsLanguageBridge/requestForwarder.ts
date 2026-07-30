import {
  CancellationToken,
  CompletionContext,
  CompletionItem,
  CompletionList,
  Disposable,
  DocumentSelector,
  Hover,
  Position,
  Range,
  SignatureHelp,
  SignatureHelpContext,
  TextDocument,
  TextEdit,
  Uri,
  commands,
  languages,
  workspace,
} from "vscode";
import { NOTEBOOK_TYPE } from "../../constant";
import { logError } from "../../utilities/logger";
import { PlainRange, toRealRange, toVirtualPosition } from "./positionMapping";
import { PRELUDE_LINE_COUNT } from "./preludeSource";
import { findCellByDocumentUri, getVirtualUriForCell } from "./virtualDocumentProvider";

const ERROR_TAG = "[jsLanguageBridge/requestForwarder]";

export const JS_CELL_SELECTOR: DocumentSelector = [
  { language: "javascript", notebookType: NOTEBOOK_TYPE },
];

const plainRangeOf = (range: Range): PlainRange => ({
  start: { line: range.start.line, character: range.start.character },
  end: { line: range.end.line, character: range.end.character },
});

const rangeOf = (range: PlainRange): Range =>
  new Range(
    new Position(range.start.line, range.start.character),
    new Position(range.end.line, range.end.character)
  );

export const getCompletionItemLabelText = (item: CompletionItem): string =>
  typeof item.label === "string" ? item.label : item.label.label;

// Translates one forwarded item's range(s) back to the real cell's coordinates in place,
// and drops additionalTextEdits: the notebook's execution model doesn't support arbitrary
// user `import`/`require` of npm packages the way a normal Node project does, so an
// auto-import edit would likely insert code that fails at execution time.
// Returns undefined if a range falls inside the prelude region (shouldn't normally happen
// for an item anchored to real cell-body text, but there's no sensible real-cell position
// to translate it to).
const translateCompletionItem = (item: CompletionItem): CompletionItem | undefined => {
  item.additionalTextEdits = undefined;

  // The hand-authored items in intellisenses/*.ts set no sortText of their own, so VS Code
  // falls back to comparing their label text -- none of those labels start with a digit.
  // Prefixing with "0" keeps forwarded items (real type/signature info) ranked ahead of
  // the hand-authored placeholders instead of getting buried among dozens of them when
  // nothing has been typed yet to narrow the list. The tie-break value keeps whatever
  // relative order the real language service itself assigned.
  item.sortText = `0${item.sortText ?? getCompletionItemLabelText(item)}`;

  // `textEdit` is deprecated in favor of `range`, but VS Code still requires its Range to
  // be on the same line completion was requested at. The built-in TS provider populates
  // it alongside `range`, so an untranslated one would still point at the *virtual*
  // document's line number -- nowhere near the real cell -- and get the whole item
  // silently rejected (this was the actual cause of forwarded items never appearing
  // during real interactive typing, confirmed via manual testing).
  if (item.textEdit) {
    const real = toRealRange(PRELUDE_LINE_COUNT, plainRangeOf(item.textEdit.range));
    if (!real) {
      return undefined;
    }
    item.textEdit = new TextEdit(rangeOf(real), item.textEdit.newText);
  }

  if (!item.range) {
    return item;
  }

  if (item.range instanceof Range) {
    const real = toRealRange(PRELUDE_LINE_COUNT, plainRangeOf(item.range));
    if (!real) {
      return undefined;
    }
    item.range = rangeOf(real);
    return item;
  }

  const insertingReal = toRealRange(PRELUDE_LINE_COUNT, plainRangeOf(item.range.inserting));
  const replacingReal = toRealRange(PRELUDE_LINE_COUNT, plainRangeOf(item.range.replacing));
  if (!insertingReal || !replacingReal) {
    return undefined;
  }
  item.range = { inserting: rangeOf(insertingReal), replacing: rangeOf(replacingReal) };
  return item;
};

// Shared by completion/hover/signature-help: resolves the owning cell, derives its
// version-keyed virtual URI (see virtualDocumentProvider.ts for why version is folded
// into the URI), and opens it so the built-in TS extension has fresh content to answer
// against. Returns undefined if the document isn't a live notebook cell.
const prepareVirtualRequest = async (
  document: TextDocument,
  position: Position
): Promise<{ virtualUri: Uri; virtualPosition: Position } | undefined> => {
  const cell = findCellByDocumentUri(document.uri);
  if (!cell) {
    return undefined;
  }
  const virtualUri = getVirtualUriForCell(cell);
  await workspace.openTextDocument(virtualUri);
  const virtual = toVirtualPosition(PRELUDE_LINE_COUNT, {
    line: position.line,
    character: position.character,
  });
  return { virtualUri, virtualPosition: new Position(virtual.line, virtual.character) };
};

export const getForwardedCompletionItems = async (
  document: TextDocument,
  position: Position,
  token: CancellationToken,
  context: CompletionContext
): Promise<CompletionItem[]> => {
  const requestedVersion = document.version;
  try {
    const prepared = await prepareVirtualRequest(document, position);
    if (!prepared || token.isCancellationRequested || document.version !== requestedVersion) {
      return [];
    }

    const result = await commands.executeCommand<CompletionList | CompletionItem[] | undefined>(
      "vscode.executeCompletionItemProvider",
      prepared.virtualUri,
      prepared.virtualPosition,
      context.triggerCharacter
    );
    if (token.isCancellationRequested || document.version !== requestedVersion) {
      return [];
    }

    const items = Array.isArray(result) ? result : result?.items ?? [];
    const translated: CompletionItem[] = [];
    for (const item of items) {
      const mapped = translateCompletionItem(item);
      if (mapped) {
        translated.push(mapped);
      }
    }
    return translated;
  } catch (e) {
    logError(`${ERROR_TAG} getForwardedCompletionItems failed`, e);
    return [];
  }
};

export const getForwardedHover = async (
  document: TextDocument,
  position: Position,
  token: CancellationToken
): Promise<Hover | undefined> => {
  const requestedVersion = document.version;
  try {
    const prepared = await prepareVirtualRequest(document, position);
    if (!prepared || token.isCancellationRequested || document.version !== requestedVersion) {
      return undefined;
    }

    const hovers = await commands.executeCommand<Hover[] | undefined>(
      "vscode.executeHoverProvider",
      prepared.virtualUri,
      prepared.virtualPosition
    );
    if (token.isCancellationRequested || document.version !== requestedVersion) {
      return undefined;
    }

    const hover = hovers?.find((h) => h.contents.length > 0);
    if (!hover) {
      return undefined;
    }
    if (!hover.range) {
      return hover;
    }

    const real = toRealRange(PRELUDE_LINE_COUNT, plainRangeOf(hover.range));
    return real ? new Hover(hover.contents, rangeOf(real)) : new Hover(hover.contents);
  } catch (e) {
    logError(`${ERROR_TAG} getForwardedHover failed`, e);
    return undefined;
  }
};

export const getForwardedSignatureHelp = async (
  document: TextDocument,
  position: Position,
  token: CancellationToken,
  context: SignatureHelpContext
): Promise<SignatureHelp | undefined> => {
  const requestedVersion = document.version;
  try {
    const prepared = await prepareVirtualRequest(document, position);
    if (!prepared || token.isCancellationRequested || document.version !== requestedVersion) {
      return undefined;
    }

    const help = await commands.executeCommand<SignatureHelp | undefined>(
      "vscode.executeSignatureHelpProvider",
      prepared.virtualUri,
      prepared.virtualPosition,
      context.triggerCharacter
    );
    if (token.isCancellationRequested || document.version !== requestedVersion) {
      return undefined;
    }

    // No range translation needed here (see positionMapping.ts docs): unlike completion
    // and hover, SignatureHelp carries no position/range information to translate back.
    return help;
  } catch (e) {
    logError(`${ERROR_TAG} getForwardedSignatureHelp failed`, e);
    return undefined;
  }
};

export const createJsHoverProvider = (): Disposable =>
  languages.registerHoverProvider(JS_CELL_SELECTOR, {
    provideHover: (document, position, token) => getForwardedHover(document, position, token),
  });

export const createJsSignatureHelpProvider = (): Disposable =>
  languages.registerSignatureHelpProvider(
    JS_CELL_SELECTOR,
    {
      provideSignatureHelp: (document, position, token, context) =>
        getForwardedSignatureHelp(document, position, token, context),
    },
    "(",
    ","
  );
