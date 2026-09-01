import type { LabelValueItem } from "../../shared/LabelValueItem";

// Backs the "Language model" picker in PerformanceTuningPreviewPanel.ts.
// It was extracted from that panel's AI-analysis design work on 2026-08-19
// so the model-list/default-selection policy remains isolated from the panel
// UI and cannot drift as the feature evolves.
//
// Deliberately takes a plain summary shape rather than importing
// vscode.LanguageModelChat as a value, so this stays a pure function with no
// `vscode` import - the caller (extension host only; `vscode.lm` doesn't
// exist in the webview) does the actual `lm.selectChatModels()` call and
// passes the result in.
export type LanguageModelSummary = {
  id: string;
  name?: string;
  vendor: string;
  family: string;
};

export type LanguageModelSelection = {
  languageModels: LabelValueItem[];
  defaultLanguageModelId: string;
};

export const MODEL_NOT_SUPPORTED_ERROR_MESSAGE =
  'Copilot reported this model as an available option, but it cannot be used by extensions in the current environment. Select a different AI model and run Analyze with AI again, or use "Copy Prompt for Other AI".';

/**
 * Copilot can temporarily advertise a model through selectChatModels() even
 * though its request endpoint rejects that same model. VS Code normally
 * wraps the provider failure, so inspect both the wrapper and its nested
 * cause instead of depending on one concrete error class/shape.
 */
export function isModelNotSupportedError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (/model_not_supported|requested model is not supported/i.test(value)) {
        return true;
      }
      continue;
    }
    if (!value || typeof value !== "object" || visited.has(value)) {
      continue;
    }
    visited.add(value);

    const candidate = value as Record<string, unknown>;
    pending.push(
      candidate.code,
      candidate.message,
      candidate.cause,
      candidate.error,
      candidate.body,
      candidate.response,
    );
  }

  return false;
}

// `LanguageModelChat.name` is a "human-readable name", not a unique key -
// Copilot can (and, per user report 2026-08-19, does) return more than one
// model entry with the identical `.name` (e.g. a directly-pinned model and
// a separately-listed "Auto"-routed variant) while `.id`/`.family`/
// `.version` differ. Left alone, that produces indistinguishable duplicate
// rows in the dropdown. Disambiguate only the colliding entries - by
// appending `.family`, and if that still collides, `.id` - so the common
// case (no collision) keeps the plain name unchanged.
function disambiguateLabels(models: LanguageModelSummary[], rawLabels: string[]): string[] {
  const countOf = (labels: string[]) => {
    const counts = new Map<string, number>();
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  };

  let labels = rawLabels;
  let counts = countOf(labels);
  if ([...counts.values()].every((c) => c === 1)) {
    return labels;
  }

  labels = labels.map((label, i) => (counts.get(label)! > 1 ? `${label} (${models[i].family})` : label));
  counts = countOf(labels);
  if ([...counts.values()].every((c) => c === 1)) {
    return labels;
  }

  return labels.map((label, i) => (counts.get(label)! > 1 ? `${label} — ${models[i].id}` : label));
}

export function buildLanguageModelSelection(models: LanguageModelSummary[]): LanguageModelSelection {
  const rawLabels = models.map((model) => (model.name ? model.name : `${model.vendor} (${model.family})`));
  const labels = disambiguateLabels(models, rawLabels);
  const languageModels: LabelValueItem[] = models.map((model, i) => ({
    label: labels[i],
    value: model.id,
  }));

  return {
    languageModels,
    defaultLanguageModelId: languageModels[0]?.value ?? "",
  };
}

function primaryLanguage(language: string): string {
  try {
    return new Intl.Locale(language).language.toLowerCase();
  } catch {
    // VS Code normally supplies a BCP 47 tag. Keep malformed/legacy tags
    // usable for the simple English guard and the label fallback below.
    return language.trim().split(/[-_]/, 1)[0].toLowerCase();
  }
}

/** Translation is only meaningful when VS Code reports a non-English UI language. */
export function isResponseTranslationAvailable(language: string | undefined): boolean {
  if (!language?.trim()) {
    return false;
  }
  return primaryLanguage(language) !== "en";
}

/** Uses the shared default for AI panels: enabled only when the option is available. */
export function defaultTranslateResponse(language: string | undefined): boolean {
  return isResponseTranslationAvailable(language);
}

/**
 * Builds the English UI label without maintaining a language-code table.
 * Returns undefined for English/unknown UI languages so the webview can omit
 * the option entirely.
 */
export function buildTranslateResponseLabel(language: string | undefined): string | undefined {
  if (!isResponseTranslationAvailable(language)) {
    return undefined;
  }

  // Availability above guarantees a non-empty language value.
  const code = language?.trim() ?? "";
  try {
    const displayName = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    if (displayName && displayName.toLowerCase() !== code.toLowerCase()) {
      return `Respond in ${displayName}`;
    }
  } catch {
    // Fall through to a useful label even if a future VS Code locale is not
    // recognized by the Electron/Node ICU data bundled with the host.
  }
  return `Respond in the VS Code display language (${code})`;
}
