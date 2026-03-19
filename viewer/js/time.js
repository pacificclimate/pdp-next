import { createTimeMetadataController } from './time/metadata.js';
import { createTimeParseHelpers } from './time/parse.js';
import { createTimeUiController } from './time/ui.js';

export function createTimeController({
  state,
  ui,
  services,
  config
}) {
  const parseHelpers = createTimeParseHelpers({
    state,
    TIME_EXPAND_LIMIT: config.TIME_EXPAND_LIMIT
  });
  const metadataController = createTimeMetadataController({
    fetchText: services.fetchText,
    parseHelpers
  });
  const uiController = createTimeUiController({
    state,
    ...ui,
    parseHelpers
  });

  return {
    parseWmsCapabilities: metadataController.parseWmsCapabilities,
    deriveTimesFromLayerDetails: metadataController.deriveTimesFromLayerDetails,
    fetchLayerTimesteps: metadataController.fetchLayerTimesteps,
    normalizeSubsetTimeSelection: uiController.normalizeSubsetTimeSelection,
    syncSubsetTimeRangeVisibility: uiController.syncSubsetTimeRangeVisibility,
    getSelectedTime: uiController.getSelectedTime,
    getSelectedTimeIndex: uiController.getSelectedTimeIndex,
    getSelectedTimeLabel: uiController.getSelectedTimeLabel,
    updateTimeUI: uiController.updateTimeUI,
    toDateInputValue: parseHelpers.toDateInputValue,
    parseSubsetDateValue: parseHelpers.parseSubsetDateValue,
    updateSubsetTimeInputsEnabled: uiController.updateSubsetTimeInputsEnabled,
    hasMultipleTimes: uiController.hasMultipleTimes
  };
}
