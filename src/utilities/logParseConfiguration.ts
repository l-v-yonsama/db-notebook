import {
  createLogEventPatternText,
  summarizeClassifyRules,
  summarizeExtractors,
  validateConfig,
  type LogParseConfig,
} from "@l-v-yonsama/multi-platform-database-drivers";
import type { LogParseConfigurationState } from "../shared/LogParseWorkflow";
import type { LogParseSettingPanelEventDataConfigSummary } from "../shared/MessageEventData";

export function readLogParseConfiguration(text?: string): {
  config?: LogParseConfig;
  configuration: LogParseConfigurationState;
  configSummary: LogParseSettingPanelEventDataConfigSummary;
} {
  const configuration: LogParseConfigurationState = {
    hasConfig: text !== undefined,
    hasSplitFields: false,
    canSplit: false,
    canParse: false,
    splitError: "",
    parseError: "",
  };
  const configSummary: LogParseSettingPanelEventDataConfigSummary = {
    logEventSplitPattern: "",
    logEventFieldsPattern: "",
    classificationSummary: "",
    extractionSummary: "",
  };
  if (text === undefined) {
    return { configuration, configSummary };
  }
  try {
    const config: LogParseConfig = JSON.parse(text);
    const splitValidation = validateConfig(config, "split");
    let parseValidation = splitValidation;
    if (splitValidation.ok) {
      configuration.availableStage = "split";
      try {
        parseValidation = validateConfig(config, "classify");
        if (parseValidation.ok) {
          configuration.availableStage = "classify";
          parseValidation = validateConfig(config, "sqlExecution");
          if (parseValidation.ok) {
            configuration.availableStage = "sqlExecution";
          }
        }
      } catch (error) {
        parseValidation = { ok: false, errorMessage: String(error) };
      }
    }
    configuration.canSplit = splitValidation.ok;
    configuration.canParse = parseValidation.ok;
    configuration.splitError = splitValidation.errorMessage;
    configuration.parseError = parseValidation.errorMessage;

    if (Array.isArray(config?.split?.fields)) {
      configuration.hasSplitFields = config.split.fields.length > 0;
      if (configuration.hasSplitFields) {
        configSummary.logEventSplitPattern = createLogEventPatternText({
          ...config.split,
          onlyStartMarker: true,
          targetForHuman: true,
        });
        configSummary.logEventFieldsPattern = createLogEventPatternText({
          ...config.split,
          targetForHuman: true,
        });
      } else if (Array.isArray(config.classify) && Array.isArray(config.extractors)) {
        configuration.splitError = "";
      }
    }
    if (configuration.availableStage && configuration.availableStage !== "split") {
      configSummary.classificationSummary = summarizeClassifyRules(config.classify);
    }
    if (configuration.canParse) {
      configSummary.extractionSummary = summarizeExtractors(config.extractors);
    }
    return { config, configuration, configSummary };
  } catch (error) {
    configuration.availableStage = undefined;
    configuration.canSplit = false;
    configuration.canParse = false;
    configuration.splitError = error instanceof Error ? error.message : String(error);
    configuration.parseError = configuration.splitError;
    return { configuration, configSummary };
  }
}
