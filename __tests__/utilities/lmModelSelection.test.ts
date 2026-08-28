import { describe, expect, it } from "vitest";
import {
  buildTranslateResponseLabel,
  buildLanguageModelSelection,
  defaultTranslateResponse,
  isResponseTranslationAvailable,
  isModelNotSupportedError,
  LanguageModelSummary,
} from "../../src/utilities/lmModelSelection";

describe("buildLanguageModelSelection", () => {
  it("maps each model to a {label, value} item, preferring name over vendor/family", () => {
    const models: LanguageModelSummary[] = [
      { id: "gpt-4o-mini", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini" },
      { id: "claude-x", vendor: "copilot", family: "claude-x" },
    ];
    const { languageModels } = buildLanguageModelSelection(models);
    expect(languageModels).toEqual([
      { label: "GPT-4o mini", value: "gpt-4o-mini" },
      { label: "copilot (claude-x)", value: "claude-x" },
    ]);
  });

  it("defaults to the first model in the input array - no family preference", () => {
    const models: LanguageModelSummary[] = [
      { id: "gpt-5-mini", name: "GPT-5 mini", vendor: "copilot", family: "gpt-5-mini" },
      { id: "gpt-4o", name: "GPT-4o", vendor: "copilot", family: "gpt-4o" },
    ];
    const { defaultLanguageModelId } = buildLanguageModelSelection(models);
    expect(defaultLanguageModelId).toBe("gpt-5-mini");
  });

  it("returns an empty list and empty default id for no models", () => {
    expect(buildLanguageModelSelection([])).toEqual({ languageModels: [], defaultLanguageModelId: "" });
  });

  it("disambiguates two models that share the same .name by appending .family (2026-08-19 report)", () => {
    const models: LanguageModelSummary[] = [
      { id: "copilot-gpt-4o-mini", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini" },
      { id: "copilot-gpt-4o-mini-auto", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini-auto" },
    ];
    const { languageModels } = buildLanguageModelSelection(models);
    expect(languageModels).toEqual([
      { label: "GPT-4o mini (gpt-4o-mini)", value: "copilot-gpt-4o-mini" },
      { label: "GPT-4o mini (gpt-4o-mini-auto)", value: "copilot-gpt-4o-mini-auto" },
    ]);
  });

  it("falls back to appending .id when .name and .family both collide", () => {
    const models: LanguageModelSummary[] = [
      { id: "id-1", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini" },
      { id: "id-2", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini" },
    ];
    const { languageModels } = buildLanguageModelSelection(models);
    expect(languageModels).toEqual([
      { label: "GPT-4o mini (gpt-4o-mini) — id-1", value: "id-1" },
      { label: "GPT-4o mini (gpt-4o-mini) — id-2", value: "id-2" },
    ]);
  });

  it("only disambiguates the colliding group, leaving unique names untouched", () => {
    const models: LanguageModelSummary[] = [
      { id: "a1", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini" },
      { id: "a2", name: "GPT-4o mini", vendor: "copilot", family: "gpt-4o-mini-auto" },
      { id: "b1", name: "GPT-5 mini", vendor: "copilot", family: "gpt-5-mini" },
    ];
    const { languageModels } = buildLanguageModelSelection(models);
    expect(languageModels).toEqual([
      { label: "GPT-4o mini (gpt-4o-mini)", value: "a1" },
      { label: "GPT-4o mini (gpt-4o-mini-auto)", value: "a2" },
      { label: "GPT-5 mini", value: "b1" },
    ]);
  });
});

describe("defaultTranslateResponse", () => {
  it("is false for English display-language variants", () => {
    expect(defaultTranslateResponse("en")).toBe(false);
    expect(defaultTranslateResponse("en-US")).toBe(false);
    expect(defaultTranslateResponse("en_GB")).toBe(false);
  });

  it("is true for a non-English display language", () => {
    expect(defaultTranslateResponse("ja")).toBe(true);
  });

  it("is false when the language is unknown/undefined", () => {
    expect(defaultTranslateResponse(undefined)).toBe(false);
    expect(defaultTranslateResponse(" ")).toBe(false);
  });
});

describe("response translation option", () => {
  it("is unavailable and unlabeled for English UI locales", () => {
    expect(isResponseTranslationAvailable("en-GB")).toBe(false);
    expect(buildTranslateResponseLabel("en-GB")).toBeUndefined();
  });

  it("uses Intl.DisplayNames for a clear non-English language label", () => {
    expect(isResponseTranslationAvailable("ja")).toBe(true);
    expect(buildTranslateResponseLabel("ja")).toBe("Respond in Japanese");
    expect(buildTranslateResponseLabel("pt-BR")).toBe("Respond in Brazilian Portuguese");
  });

  it("falls back to the locale code when ICU has no display name", () => {
    expect(buildTranslateResponseLabel("xx")).toBe(
      "Respond in the VS Code display language (xx)"
    );
    expect(buildTranslateResponseLabel("bad_code")).toBe(
      "Respond in the VS Code display language (bad_code)"
    );
  });
});

describe("isModelNotSupportedError", () => {
  it("recognizes the Copilot 400 response embedded in an Error message", () => {
    expect(
      isModelNotSupportedError(
        new Error(
          'Request Failed: 400 {"error":{"message":"The requested model is not supported.","code":"model_not_supported"}}'
        )
      )
    ).toBe(true);
  });

  it("recognizes a provider error nested under a VS Code-style cause", () => {
    expect(
      isModelNotSupportedError({
        code: "Unknown",
        cause: { code: "model_not_supported", message: "The requested model is not supported." },
      })
    ).toBe(true);
  });

  it("does not quarantine models for unrelated request failures", () => {
    expect(isModelNotSupportedError(new Error("Quota exceeded"))).toBe(false);
  });
});
