import { createTimeMetadataController } from './time/metadata.js';
import { createTimeParseHelpers } from './time/parse.js';
import { createTimeUiController } from './time/ui.js';

export function createTimeController({
  state,
  ui
}) {
  const parseHelpers = createTimeParseHelpers();
  const metadataController = createTimeMetadataController();
  const uiController = createTimeUiController({
    state,
    ...ui,
    parseHelpers
  });

  return {
    parseWmsCapabilities: metadataController.parseWmsCapabilities,
    getSubsetTimeMode: uiController.getSubsetTimeMode,
    normalizeSubsetTimeSelection: uiController.normalizeSubsetTimeSelection,
    syncSubsetTimeRangeVisibility: uiController.syncSubsetTimeRangeVisibility,
    getSelectedTime: uiController.getSelectedTime,
    getSelectedTimeIndex: uiController.getSelectedTimeIndex,
    getSelectedTimeLabel: uiController.getSelectedTimeLabel,
    updateTimeUI: uiController.updateTimeUI,
    toDateInputValue: parseHelpers.toDateInputValue,
    updateSubsetTimeInputsEnabled: uiController.updateSubsetTimeInputsEnabled,
    selectTimeFromDateInput: uiController.selectTimeFromDateInput,
    toggleTimeCalendar: uiController.toggleTimeCalendar,
    closeTimeCalendars: uiController.closeTimeCalendars,
    toggleSubsetTimeCalendar: uiController.toggleSubsetTimeCalendar,
    applySubsetTimeCalendarSelection: uiController.applySubsetTimeCalendarSelection,
    validateSubsetTimeRange: uiController.validateSubsetTimeRange,
    adjustSubsetEndForStart: uiController.adjustSubsetEndForStart,
    hasMultipleTimes: uiController.hasMultipleTimes
  };
}
