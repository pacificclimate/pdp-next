import { buildPortalUrl } from './core/config.js';
import { logMinForScaleSwitch } from './map/controller.js';
import { createMetadataDialogController } from './metadata.js';
import {
  timeModeBtns,
  timeSlider,
  timeValue,
  timeOptions,
  timeCalendarBtn,
  timeCalendar,
  calendarDismissLayer,
  subsetTimeStartCalendarBtn,
  subsetTimeEndCalendarBtn,
  subsetTimeStartCalendar,
  subsetTimeEndCalendar,
  subsetTimeStart,
  subsetTimeEnd,
  opacitySlider,
  applyScaleBtn,
  styleSelect,
  scaleType,
  scaleMin,
  paletteSelect,
  portalSelect,
  metadataBtn,
  metadataDialog,
  metadataSummary,
  metadataMarkdownDownload,
  metadataJsonDownload,
  metadataNcmlDownload,
  crsSelect,
  subsetTimeModeInputs,
  subsetSpatialMode,
  subsetClearDraw,
  subsetDownloadBtn,
  setStatus
} from './core/dom.js';

export function wireEvents({
  state,
  activePortalId,
  // time
  getSubsetTimeMode,
  getSelectedTimeIndex,
  getSelectedTimeLabel,
  hasMultipleTimes,
  updateTimeUI,
  normalizeSubsetTimeSelection,
  syncSubsetTimeRangeVisibility,
  updateSubsetTimeInputsEnabled,
  selectTimeFromDateInput,
  toggleTimeCalendar,
  closeTimeCalendars,
  toggleSubsetTimeCalendar,
  applySubsetTimeCalendarSelection,
  validateSubsetTimeRange,
  adjustSubsetEndForStart,
  // map
  refreshInfoPanel,
  updateMap,
  setLayerOpacity,
  syncPaletteEnabled,
  setMapProjection,
  getCurrentCrs,
  // subset
  setSubsetDrawMode,
  clearSubsetDrawing,
  downloadSubset,
  viewerStateChanged
}) {
  let lastAppliedTimeSliderValue = null;
  const metadataDialogController = createMetadataDialogController({
    dialog: metadataDialog,
    summary: metadataSummary,
    markdownDownload: metadataMarkdownDownload,
    jsonDownload: metadataJsonDownload,
    ncmlDownload: metadataNcmlDownload,
  });

  function refreshTimeSelectionIfChanged(nextIndex) {
    const currentIndex = getSelectedTimeIndex();
    const boundedIndex = Math.max(
      0,
      Math.min(state.times.length - 1, Number(nextIndex) || 0),
    );
    if (boundedIndex === currentIndex) {
      updateTimeUI();
      return false;
    }
    timeSlider.value = String(boundedIndex);
    lastAppliedTimeSliderValue = timeSlider.value;
    updateTimeUI();
    timeValue.value = getSelectedTimeLabel();
    refreshInfoPanel();
    updateMap();
    viewerStateChanged();
    return true;
  }

  timeModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!hasMultipleTimes()) {
        updateTimeUI();
        return;
      }
      const mode = btn.dataset.mode;
      const current = getSelectedTimeIndex();
      const last = Math.max(0, state.times.length - 1);
      if (mode === 'first') refreshTimeSelectionIfChanged(0);
      else if (mode === 'last') refreshTimeSelectionIfChanged(last);
      else if (mode === 'prev') refreshTimeSelectionIfChanged(current > 0 ? current - 1 : last);
      else if (mode === 'next') refreshTimeSelectionIfChanged(current < last ? current + 1 : 0);
    });
  });

  timeSlider.addEventListener('input', () => {
    if (!hasMultipleTimes()) {
      updateTimeUI();
      return;
    }
    const nextValue = String(timeSlider.value || '0');
    if (nextValue === lastAppliedTimeSliderValue) return;
    lastAppliedTimeSliderValue = nextValue;
    updateTimeUI();
    timeValue.value = getSelectedTimeLabel();
    refreshInfoPanel();
    updateMap();
    viewerStateChanged();
  });
  timeSlider.addEventListener('change', () => {
    if (!hasMultipleTimes()) {
      updateTimeUI();
      return;
    }
    const nextValue = String(timeSlider.value || '0');
    if (nextValue === lastAppliedTimeSliderValue) return;
    lastAppliedTimeSliderValue = nextValue;
    updateTimeUI();
    refreshInfoPanel();
    updateMap();
    viewerStateChanged();
  });

  timeValue.addEventListener('change', () => {
    const selection = selectTimeFromDateInput(timeValue.value);
    if (!selection.valid) {
      timeValue.setAttribute('aria-invalid', 'true');
      setStatus(selection.message, true);
      updateTimeUI();
      return;
    }
    timeValue.removeAttribute('aria-invalid');
    refreshTimeSelectionIfChanged(selection.index);
  });
  timeValue.addEventListener('input', () => timeValue.removeAttribute('aria-invalid'));
  timeValue.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') timeValue.blur();
  });
  timeCalendarBtn?.addEventListener('click', () => {
    toggleTimeCalendar();
  });
  timeCalendar?.addEventListener('click', (event) => {
    if (event.target.closest('button[data-calendar-close]')) {
      closeTimeCalendars();
      return;
    }
    const option = event.target.closest('button[data-time-index]');
    if (!option) return;
    refreshTimeSelectionIfChanged(Number(option.dataset.timeIndex));
  });

  subsetTimeStartCalendarBtn?.addEventListener('click', () => toggleSubsetTimeCalendar('start'));
  subsetTimeEndCalendarBtn?.addEventListener('click', () => toggleSubsetTimeCalendar('end'));
  subsetTimeStartCalendar?.addEventListener('click', (event) => {
    if (event.target.closest('button[data-calendar-close]')) {
      closeTimeCalendars();
      return;
    }
    const option = event.target.closest('button[data-subset-time-index]');
    if (!option) return;
    applySubsetTimeCalendarSelection('start', Number(option.dataset.subsetTimeIndex));
    const adjustment = adjustSubsetEndForStart();
    if (adjustment) {
      adjustment.input.classList.add("is-adjusted");
      window.setTimeout(() => adjustment.input.classList.remove("is-adjusted"), 2200);
      setStatus(adjustment.isFinalTimestep
        ? `End date adjusted to the latest available date (${adjustment.value}).`
        : `End date adjusted to the next available date (${adjustment.value}).`);
    }
  });
  subsetTimeEndCalendar?.addEventListener('click', (event) => {
    if (event.target.closest('button[data-calendar-close]')) {
      closeTimeCalendars();
      return;
    }
    const option = event.target.closest('button[data-subset-time-index]');
    if (!option) return;
    applySubsetTimeCalendarSelection('end', Number(option.dataset.subsetTimeIndex));
  });
  [subsetTimeStart, subsetTimeEnd].forEach((input) => {
    input?.addEventListener('input', () => {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    });
    input?.addEventListener('change', () => {
      if (input.disabled) return;
      let result = validateSubsetTimeRange();
      const adjustment = input === subsetTimeStart && result.field === "range"
        ? adjustSubsetEndForStart() : null;
      if (adjustment) {
        adjustment.input.classList.add("is-adjusted");
        window.setTimeout(() => adjustment.input.classList.remove("is-adjusted"), 2200);
        setStatus(adjustment.isFinalTimestep
          ? `End date adjusted to the latest available date (${adjustment.value}).`
          : `End date adjusted to the next available date (${adjustment.value}).`);
        return;
      }
      if (result.valid) return;
      const invalidInputs = result.field === 'start' ? [subsetTimeStart]
        : result.field === 'end' ? [subsetTimeEnd] : [subsetTimeStart, subsetTimeEnd];
      invalidInputs.forEach((field) => {
        field.classList.add('is-invalid');
        field.setAttribute('aria-invalid', 'true');
      });
      setStatus(result.message, true);
    });
  });

  timeValue.addEventListener('click', () => {
    if (!timeValue.readOnly || timeValue.disabled || !timeOptions) return;
    const open = timeOptions.hidden;
    timeOptions.hidden = !open;
    timeValue.setAttribute('aria-expanded', String(open));
  });
  timeOptions?.addEventListener('click', (event) => {
    const option = event.target.closest('button[data-time-index]');
    if (!option) return;
    timeOptions.hidden = true;
    timeValue.setAttribute('aria-expanded', 'false');
    refreshTimeSelectionIfChanged(Number(option.dataset.timeIndex));
  });
  const pendingCalendarIndex = (calendar) => {
    const index = Number(calendar?.dataset?.previewIndex);
    return Number.isInteger(index) && index >= 0 && index < state.times.length ? index : null;
  };
  const commitPendingCalendarSelection = () => {
    if (!timeCalendar?.hidden) {
      const index = pendingCalendarIndex(timeCalendar);
      if (index !== null) refreshTimeSelectionIfChanged(index);
      return;
    }
    if (!subsetTimeStartCalendar?.hidden) {
      const index = pendingCalendarIndex(subsetTimeStartCalendar);
      if (index !== null) applySubsetTimeCalendarSelection("start", index);
      return;
    }
    if (!subsetTimeEndCalendar?.hidden) {
      const index = pendingCalendarIndex(subsetTimeEndCalendar);
      if (index !== null) applySubsetTimeCalendarSelection("end", index);
    }
  };
  calendarDismissLayer?.addEventListener('click', () => {
    commitPendingCalendarSelection();
    closeTimeCalendars();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTimeCalendars();
  });
  opacitySlider.addEventListener('input', () => {
    setLayerOpacity(opacitySlider.value);
    viewerStateChanged();
  });

  scaleType.addEventListener('change', () => {
    if (scaleType.value === 'log') {
      const nextMin = logMinForScaleSwitch(scaleMin.value, state.currentDataset?.rendering);
      if (nextMin !== null) scaleMin.value = String(nextMin);
    }
    updateMap();
    viewerStateChanged();
  });

  applyScaleBtn.addEventListener('click', () => {
    updateMap();
    viewerStateChanged();
  });
  styleSelect.addEventListener('change', () => {
    syncPaletteEnabled();
    updateMap();
    viewerStateChanged();
  });
  paletteSelect.addEventListener('change', () => {
    updateMap();
    viewerStateChanged();
  });

  portalSelect.addEventListener('change', (e) => {
    const next = String(e.target.value || '').trim().toLowerCase();
    if (!next || next === activePortalId) return;
    window.location.assign(buildPortalUrl(next));
  });

  metadataBtn.addEventListener('click', () => {
    if (!state.currentDataset) return setStatus('Please select a dataset first', true);
    metadataDialogController.show(state.currentDataset);
  });

  crsSelect.addEventListener('change', () => {
    const wanted = crsSelect.value;
    if (!setMapProjection(wanted)) {
      setStatus(`Unknown CRS: ${wanted}`, true);
      crsSelect.value = getCurrentCrs();
      return;
    }
    updateMap();
    viewerStateChanged();
  });

  subsetTimeModeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      state.subset.timeMode = getSubsetTimeMode();
      normalizeSubsetTimeSelection();
      syncSubsetTimeRangeVisibility();
      updateSubsetTimeInputsEnabled();
    });
  });

  subsetSpatialMode.addEventListener('change', () => {
    const mode = (subsetSpatialMode.value || 'viewport').toLowerCase();
    state.subset.spatialMode = mode;
    setSubsetDrawMode(mode);
  });

  subsetClearDraw.addEventListener('click', () => {
    clearSubsetDrawing();
    setStatus('Subset drawing cleared.');
  });

  subsetDownloadBtn.addEventListener('click', downloadSubset);
}
