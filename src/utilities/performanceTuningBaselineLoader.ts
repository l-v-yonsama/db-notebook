// Reads a previously saved Performance Tuning `.dbn` and extracts the Full
// Context it holds, so the Preview can compare against it
// (misc/specs/performance-tuning-baseline-comparison-implementation-plan.ja.md
// §6).
//
// Split deliberately in two: extractBaselineContext() is a pure function over
// the file's text (everything §17.1 tests), and the VS Code pieces below it -
// the open dialog and the file read - do nothing but hand that function a
// string. The baseline .dbn is opened read-only and never written back (§1).

import {
  isDynamoDbPerformanceTuningContext,
  validateDynamoDbPerformanceTuningContext,
  validatePerformanceTuningContext,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { Uri, window, workspace } from "vscode";
import type {
  AnyTuningContext,
  PerformanceTuningBaselineSelection,
} from "../shared/PerformanceTuningComparison";
import type { CellMeta, RawNotebookData } from "../types/Notebook";
import { readResource } from "./fsUtil";
import { hashContext } from "./performanceTuningComparison";

/**
 * Context cell labels in priority order (§6.2). A report saved with a
 * comparison carries both sides, so the Current one has to win - otherwise
 * chaining two comparisons would silently reach back to the older baseline.
 * A report saved before this feature only has the second label.
 */
export const BASELINE_CONTEXT_CELL_LABELS = [
  "Current Full context JSON",
  "Full context JSON",
] as const;

// Labels a comparison-aware report also carries. Listed only so the error
// message for "baseline-only report" can name what it found instead of
// saying nothing was there.
const BASELINE_ONLY_CELL_LABEL = "Baseline Full context JSON";

const SUPPORTED_FORMAT_VERSION = 1;

export type BaselineExtractionResult =
  | { ok: true; context: AnyTuningContext }
  | { ok: false; message: string };

/**
 * Pulls the Context out of a `.dbn`'s raw text. Refuses rather than guesses
 * whenever the file is not unambiguously one saved Performance Tuning report:
 * a wrong baseline produces a plausible-looking but meaningless improvement
 * figure, which is worse than no comparison at all (§6.2).
 *
 * Markdown cells and any AI analysis JSON in the file are deliberately not
 * read. Text a model wrote about an earlier run must never become an input
 * fact for a new comparison (§6.2).
 */
export function extractBaselineContext(fileText: string): BaselineExtractionResult {
  let raw: RawNotebookData;
  try {
    raw = JSON.parse(fileText) as RawNotebookData;
  } catch {
    return {
      ok: false,
      message: "The selected file is not a readable notebook (its JSON could not be parsed).",
    };
  }
  if (!Array.isArray(raw?.cells)) {
    return { ok: false, message: "The selected file is not a notebook (it has no cells)." };
  }

  const labelled = raw.cells.filter((cell) => typeof labelOf(cell) === "string");
  for (const label of BASELINE_CONTEXT_CELL_LABELS) {
    const matches = labelled.filter((cell) => labelOf(cell) === label);
    if (matches.length === 0) {
      continue;
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `The selected notebook has ${matches.length} cells labelled "${label}", so there is no single context to compare against.`,
      };
    }
    return parseAndValidate(matches[0].value, label);
  }

  if (labelled.some((cell) => labelOf(cell) === BASELINE_ONLY_CELL_LABEL)) {
    return {
      ok: false,
      message: `The selected notebook only contains a "${BASELINE_ONLY_CELL_LABEL}" cell, which is another report's baseline rather than its own result.`,
    };
  }
  return {
    ok: false,
    message:
      "The selected notebook has no Full context JSON cell, so it is not a saved Performance Tuning report.",
  };
}

function labelOf(cell: { metadata?: CellMeta }): string | undefined {
  const label = cell.metadata?.cellLabel;
  return typeof label === "string" ? label : undefined;
}

function parseAndValidate(cellValue: string, label: string): BaselineExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cellValue);
  } catch {
    return {
      ok: false,
      message: `The "${label}" cell in the selected notebook does not contain valid JSON.`,
    };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, message: `The "${label}" cell does not contain a context object.` };
  }

  const formatVersion = (parsed as { formatVersion?: unknown }).formatVersion;
  if (formatVersion !== SUPPORTED_FORMAT_VERSION) {
    // Fail closed on an unknown version rather than validating optimistically:
    // a future format could move or redefine a field this comparison reads.
    return {
      ok: false,
      message: `The selected notebook's context uses format version ${String(formatVersion)}, which this version of the extension cannot read (it supports version ${SUPPORTED_FORMAT_VERSION}).`,
    };
  }

  const context = parsed as AnyTuningContext;
  const violations = isDynamoDbPerformanceTuningContext(context)
    ? validateDynamoDbPerformanceTuningContext(context)
    : validatePerformanceTuningContext(context);
  if (violations.length > 0) {
    return {
      ok: false,
      message: `The selected notebook's context failed validation (${violations.join("; ")}).`,
    };
  }
  return { ok: true, context };
}

// ---------------------------------------------------------------------------
// VS Code plumbing (§6.1, §6.3)
// ---------------------------------------------------------------------------

// Where saveAiAnalysisAsNotebook()/saveDynamoDbAiAnalysisAsNotebook() put
// their reports, so the dialog opens where the user's own baselines already
// are.
const REPORTS_SUBPATH = ["reports", "performance-tuning"] as const;

export type BaselineLoadResult =
  | { ok: true; selection: PerformanceTuningBaselineSelection }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

/**
 * Shows the open dialog and loads whatever the user picked. `lastDirectory`
 * is the caller's remembered workspace-state value; the absolute path of a
 * chosen baseline is never written to global settings (§6.1).
 */
export async function promptForBaselineSelection(params: {
  lastDirectory?: Uri;
  now?: Date;
}): Promise<BaselineLoadResult> {
  const picked = await window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: "Select baseline report",
    title: "Select a saved Performance Tuning report to compare against",
    filters: { "Database notebook": ["dbn"] },
    defaultUri: params.lastDirectory ?? defaultReportsDirectory(),
  });
  if (!picked || picked.length === 0) {
    return { ok: false, cancelled: true };
  }
  return loadBaselineSelection(picked[0], params.now);
}

function defaultReportsDirectory(): Uri | undefined {
  const wsFolder = workspace.workspaceFolders?.[0];
  return wsFolder ? Uri.joinPath(wsFolder.uri, ...REPORTS_SUBPATH) : undefined;
}

/**
 * Reads the file once and keeps the extracted Context as an immutable
 * snapshot. Nothing re-reads the file afterwards: a comparison already shown
 * (or already saved into a report) has to stay reproducible even if the
 * baseline is later moved, edited, or deleted (§6.3).
 */
export async function loadBaselineSelection(
  uri: Uri,
  now: Date = new Date()
): Promise<BaselineLoadResult> {
  let fileText: string;
  try {
    fileText = await readResource(uri);
  } catch {
    return { ok: false, message: `The selected file could not be read (${uri.fsPath}).` };
  }

  const extracted = extractBaselineContext(fileText);
  if (!extracted.ok) {
    return extracted;
  }

  return {
    ok: true,
    selection: {
      source: {
        fileName: baseName(uri),
        sourcePath: uri.fsPath,
        contextSha256: hashContext(extracted.context),
        collectedAt: extracted.context.collection.collectedAt,
        selectedAt: now.toISOString(),
      },
      context: extracted.context,
    },
  };
}

function baseName(uri: Uri): string {
  const segments = uri.path.split("/");
  return segments[segments.length - 1] || uri.fsPath;
}
