import { describeCfDateRangeError } from './cftime.js';
import { adjustedEndIndex, calendarDateRecords, renderCalendarPicker } from "./calendar-picker.js";

export function createTimeUiController({
  state,
  timeModeBtns,
  timeSlider,
  timeSliderContainer,
  timeValue,
  timeEntryNotice,
  timeOptions,
  timeCalendarBtn,
  timeCalendar,
  calendarDismissLayer,
  subsetTimeStartCalendarBtn,
  subsetTimeEndCalendarBtn,
  subsetTimeStartCalendar,
  subsetTimeEndCalendar,
  subsetTimeModeFull,
  subsetTimeModeCurrent,
  subsetTimeModeRange,
  subsetTimeModeInputs,
  subsetTimeStart,
  subsetTimeEnd,
  parseHelpers
}) {
  const {
    formatSeasonLabel,
    formatMonthLabel,
    formatDailyLabel
  } = parseHelpers;

  function getSelectedTimeIndex() {
    if (!state.times.length) return 0;
    return Math.max(
      0,
      Math.min(
        state.times.length - 1,
        parseInt(timeSlider.value || '0', 10) || 0
      )
    );
  }

  function hasMultipleTimes() {
    return state.times.length > 1;
  }

  function allowsRangeSubset() {
    return Number(state.currentDataset?.timeMetadata?.count || state.times?.length || 0) > 12;
  }

  function allowsDirectTimeEntry() {
    return hasMultipleTimes() && state.times.length !== 4 && state.times.length !== 12;
  }

  function getSubsetTimeMode() {
    return Array.from(subsetTimeModeInputs).find((input) => input.checked)?.value || 'full';
  }

  function normalizeSubsetTimeSelection() {
    if (
      (!hasMultipleTimes() && subsetTimeModeCurrent.checked)
      || (!allowsRangeSubset() && subsetTimeModeRange.checked)
    ) {
      subsetTimeModeFull.checked = true;
    }
    state.subset.timeMode = getSubsetTimeMode();
  }

  function syncSubsetTimeRangeVisibility() {
    normalizeSubsetTimeSelection();
    const rangeAllowed = allowsRangeSubset();
    const currentAllowed = hasMultipleTimes();
    const showRangeSubset = rangeAllowed;
    subsetTimeModeCurrent.closest('.choice-option')?.classList.toggle('is-hidden', !currentAllowed);
    subsetTimeModeCurrent.disabled = !currentAllowed;
    subsetTimeModeRange.closest('.choice-option')?.classList.toggle('disabled', !rangeAllowed);
    subsetTimeModeRange.disabled = !rangeAllowed;
    subsetTimeStart?.closest('.color-row')?.classList.toggle('is-hidden', !showRangeSubset);
    subsetTimeEnd?.closest('.color-row')?.classList.toggle('is-hidden', !showRangeSubset);
  }

  function getSelectedTime() {
    if (!state.times.length) return '—';
    return state.times[getSelectedTimeIndex()];
  }

  function getSelectedTimeLabel() {
    const selected = getSelectedTime();
    if (selected === '—') return selected;
    if (state.times.length === 12) return formatMonthLabel(selected);
    if (state.times.length === 4) {
      const labels = state.times.map(formatSeasonLabel);
      const unique = new Set(labels);
      if (['DJF', 'MAM', 'JJA', 'SON'].some((v) => unique.has(v))) {
        const idx = Math.max(0, Math.min(state.times.length - 1, parseInt(timeSlider.value || '0', 10) || 0));
        return labels[idx] || selected;
      }
    }
    return formatDailyLabel(selected);
  }

  function setTimeButtonsEnabled(enabled) {
    const currentIndex = getSelectedTimeIndex();
    const lastIndex = Math.max(0, state.times.length - 1);
    timeModeBtns.forEach((button) => {
      let buttonEnabled = enabled;
      const mode = String(button.dataset.mode || '').toLowerCase();
      if (buttonEnabled && mode === 'first') {
        buttonEnabled = currentIndex > 0;
      } else if (buttonEnabled && mode === 'last') {
        buttonEnabled = currentIndex < lastIndex;
      }
      button.disabled = !buttonEnabled;
      button.classList.toggle('disabled', !buttonEnabled);
    });
  }

  function updateTimeUI() {
    const hasAny = state.times.length > 0;
    const multiTime = hasMultipleTimes();
    const timeModeGroup = timeModeBtns?.[0]?.closest('.time-mode-group');
    if (timeModeGroup) timeModeGroup.classList.toggle('is-hidden', !multiTime);
    timeSliderContainer.classList.toggle('disabled', !multiTime);
    timeSliderContainer.classList.toggle('is-hidden', !multiTime);
    timeSlider.disabled = !multiTime;
    timeSlider.max = String(Math.max(0, state.times.length - 1));
    timeSlider.value = String(getSelectedTimeIndex());
    setTimeButtonsEnabled(hasAny && multiTime);
    const directEntryAllowed = allowsDirectTimeEntry();
    timeValue.disabled = !hasAny || (!directEntryAllowed && !multiTime);
    timeValue.readOnly = !directEntryAllowed && multiTime;
    timeValue.setAttribute('aria-haspopup', multiTime && !directEntryAllowed ? 'listbox' : 'false');
    timeValue.setAttribute('aria-expanded', 'false');
    timeValue.removeAttribute('aria-invalid');
    timeValue.value = hasAny ? getSelectedTimeLabel() : '';
    if (timeEntryNotice) {
      timeEntryNotice.hidden = !hasAny;
      timeEntryNotice.textContent = directEntryAllowed
        ? 'Enter an exact date, or use the slider.'
        : multiTime ? 'Choose a time step from the list, or use the slider.' : 'This dataset has one time step.';
    }
    syncSubsetTimeRangeVisibility();
    updateSubsetTimeInputsEnabled();
    syncTimeOptions();
    syncTimeCalendar();
  }

  function syncTimeOptions() {
    if (!timeOptions) return;
    const showOptions = hasMultipleTimes() && !allowsDirectTimeEntry();
    timeOptions.hidden = true;
    timeOptions.replaceChildren();
    if (!showOptions) return;
    state.times.forEach((time, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.timeIndex = String(index);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === getSelectedTimeIndex()));
      option.textContent = state.times.length === 12 ? formatMonthLabel(time) : formatSeasonLabel(time);
      timeOptions.append(option);
    });
  }

  function availableDateRecords() {
    return calendarDateRecords(state.times, formatDailyLabel);
  }

  function renderTimeCalendar() {
    renderCalendarPicker({
      container: timeCalendar,
      records: availableDateRecords(),
      selectedIndex: getSelectedTimeIndex(),
      selectionDatasetKey: "timeIndex",
      onClose: closeTimeCalendars
    });
  }

  function closeTimeCalendars() {
    if (calendarDismissLayer) calendarDismissLayer.hidden = true;
    [timeCalendar, subsetTimeStartCalendar, subsetTimeEndCalendar].forEach((calendar) => {
      if (calendar) calendar.hidden = true;
    });
    [timeCalendarBtn, subsetTimeStartCalendarBtn, subsetTimeEndCalendarBtn].forEach((button) => {
      button?.setAttribute("aria-expanded", "false");
    });
  }

  function syncTimeCalendar() {
    if (!timeCalendarBtn || !timeCalendar) return;
    const enabled = allowsDirectTimeEntry();
    timeCalendarBtn.disabled = !enabled;
    timeCalendarBtn.hidden = !enabled;
    closeTimeCalendars();
    if (!enabled) timeCalendar.replaceChildren();
  }

  function toggleTimeCalendar() {
    if (!timeCalendar || !allowsDirectTimeEntry()) return;
    const open = timeCalendar.hidden;
    if (open) renderTimeCalendar();
    timeCalendar.hidden = !open;
    if (calendarDismissLayer) calendarDismissLayer.hidden = !open;
    timeCalendarBtn?.setAttribute('aria-expanded', String(open));
  }

  function subsetCalendarConstraint(boundary) {
    const oppositeInput = boundary === "start" ? subsetTimeEnd : subsetTimeStart;
    const oppositeIndex = state.times.findIndex((time) => formatDailyLabel(time) === oppositeInput.value);
    return (record) => oppositeIndex >= 0
      && (boundary === "start" ? record.index > oppositeIndex : record.index < oppositeIndex);
  }

  function renderSubsetTimeCalendar(boundary) {
    const calendar = boundary === "start" ? subsetTimeStartCalendar : subsetTimeEndCalendar;
    const input = boundary === "start" ? subsetTimeStart : subsetTimeEnd;
    const records = availableDateRecords();
    const isDisabled = subsetCalendarConstraint(boundary);
    const selectedIndex = records.find((record) => formatDailyLabel(state.times[record.index]) === input.value)?.index;
    renderCalendarPicker({
      container: calendar,
      records,
      selectedIndex,
      selectionDatasetKey: "subsetTimeIndex",
      isDisabled,
      onClose: closeTimeCalendars
    });
  }

  function toggleSubsetTimeCalendar(boundary) {
    const calendar = boundary === "start" ? subsetTimeStartCalendar : subsetTimeEndCalendar;
    const button = boundary === "start" ? subsetTimeStartCalendarBtn : subsetTimeEndCalendarBtn;
    if (!calendar || button?.disabled) return;
    const open = calendar.hidden;
    if (open) renderSubsetTimeCalendar(boundary);
    calendar.hidden = !open;
    if (calendarDismissLayer) calendarDismissLayer.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    const otherCalendar = boundary === "start" ? subsetTimeEndCalendar : subsetTimeStartCalendar;
    const otherButton = boundary === "start" ? subsetTimeEndCalendarBtn : subsetTimeStartCalendarBtn;
    if (otherCalendar) otherCalendar.hidden = true;
    otherButton?.setAttribute("aria-expanded", "false");
  }

  function applySubsetTimeCalendarSelection(boundary, index) {
    const input = boundary === "start" ? subsetTimeStart : subsetTimeEnd;
    input.value = formatDailyLabel(state.times[index]);
    closeTimeCalendars();
  }

  function updateSubsetTimeInputsEnabled() {
    const enabled = allowsRangeSubset() && getSubsetTimeMode() === 'range';
    subsetTimeStart.disabled = !enabled;
    subsetTimeEnd.disabled = !enabled;
    [subsetTimeStartCalendarBtn, subsetTimeEndCalendarBtn].forEach((button) => {
      if (!button) return;
      button.disabled = !enabled;
      if (!enabled) button.setAttribute("aria-expanded", "false");
    });
    if (!enabled) {
      subsetTimeStartCalendar.hidden = true;
      subsetTimeEndCalendar.hidden = true;
    }
  }

  function adjustSubsetEndForStart() {
    const start = String(subsetTimeStart.value || "").trim().replace(/\//g, "-");
    const end = String(subsetTimeEnd.value || "").trim().replace(/\//g, "-");
    const adjustedIndex = adjustedEndIndex(state.times, formatDailyLabel, start, end);
    if (adjustedIndex === null) return null;
    subsetTimeEnd.value = formatDailyLabel(state.times[adjustedIndex]);
    return {
      input: subsetTimeEnd,
      value: subsetTimeEnd.value,
      isFinalTimestep: adjustedIndex === state.times.length - 1
    };
  }

  function validateSubsetTimeRange() {
    const start = String(subsetTimeStart.value || "").trim().replace(/\//g, "-");
    const end = String(subsetTimeEnd.value || "").trim().replace(/\//g, "-");
    const calendar = state.currentDataset?.timeMetadata?.calendar || "standard";
    const error = describeCfDateRangeError(start, end, calendar);
    return error ? { valid: false, ...error } : { valid: true };
  }

  function selectTimeFromDateInput(value) {
    const requested = String(value || '').trim().replace(/\//g, '-');
    if (!allowsDirectTimeEntry()) {
      return { valid: false, message: 'This time selection uses fixed labels and cannot be entered as a date.' };
    }

    const calendar = state.currentDataset?.timeMetadata?.calendar || 'standard';
    const dateError = describeCfDateRangeError(requested, requested, calendar);
    if (dateError) return { valid: false, message: dateError.message };

    const index = state.times.findIndex((time) => formatDailyLabel(time) === requested);
    if (index >= 0) return { valid: true, index };

    const first = formatDailyLabel(state.times[0]);
    const last = formatDailyLabel(state.times[state.times.length - 1]);
    const inAvailableRange = requested >= first && requested <= last;
    return {
      valid: false,
      message: inAvailableRange
        ? `No timestep is available for ${requested}. Choose one of this dataset's available dates.`
        : `Date must be within this dataset's available range (${first} to ${last}).`
    };
  }

  return {
    allowsRangeSubset,
    getSubsetTimeMode,
    normalizeSubsetTimeSelection,
    syncSubsetTimeRangeVisibility,
    getSelectedTime,
    getSelectedTimeIndex,
    getSelectedTimeLabel,
    updateTimeUI,
    updateSubsetTimeInputsEnabled,
    selectTimeFromDateInput,
    syncTimeOptions,
    toggleTimeCalendar,
    closeTimeCalendars,
    toggleSubsetTimeCalendar,
    applySubsetTimeCalendarSelection,
    validateSubsetTimeRange,
    adjustSubsetEndForStart,
    hasMultipleTimes
  };
}
