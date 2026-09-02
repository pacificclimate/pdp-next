import { buildPortalUrl } from './core/config.js';
import {
  timeModeBtns,
  timeSlider,
  timeValue,
  opacitySlider,
  applyScaleBtn,
  styleSelect,
  paletteSelect,
  portalSelect,
  metadataBtn,
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
    timeValue.textContent = getSelectedTimeLabel();
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
    timeValue.textContent = getSelectedTimeLabel();
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

  opacitySlider.addEventListener('input', () => {
    setLayerOpacity(opacitySlider.value);
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
    if (!state.currentDataset) return alert('Please select a dataset first');
    window.open(state.currentDataset.ncmlUrl, '_blank', 'noopener');
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
