import type { LabelValueItem } from "../../shared/LabelValueItem";

// Pure model-selection policy for the preview's language-model picker.
// The extension host supplies summaries because `vscode.lm` is unavailable in the webview.
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

// Model names are not unique. Add family, then id, only for duplicate labels.
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
