import { WMS_VERSION, DEFAULT_CANADA_BBOX_4326 } from './core/config.js';
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
  subsetFullTime,
  subsetCurrentTime,
  subsetSpatialMode,
  subsetClearDraw,
  subsetDownloadBtn,
  setStatus
} from './core/dom.js';

export function wireEvents({
  state,
  requestedPortalId,
  // time
  getSelectedTimeLabel,
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
  fitMapToBbox4326,
  // subset
  setSubsetDrawMode,
  clearSubsetDrawing,
  downloadSubset
}) {
  timeModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      const current = Math.max(0, Math.min(state.times.length - 1, parseInt(timeSlider.value || '0', 10) || 0));
      if (mode === 'first') timeSlider.value = '0';
      else if (mode === 'last') timeSlider.value = String(Math.max(0, state.times.length - 1));
      else if (mode === 'prev') timeSlider.value = String(Math.max(0, current - 1));
      else if (mode === 'next') timeSlider.value = String(Math.min(Math.max(0, state.times.length - 1), current + 1));
      updateTimeUI();
      timeValue.textContent = getSelectedTimeLabel();
      refreshInfoPanel();
      updateMap();
    });
  });

  timeSlider.addEventListener('input', () => {
    timeValue.textContent = getSelectedTimeLabel();
    refreshInfoPanel();
    updateMap();
  });
  timeSlider.addEventListener('change', () => {
    refreshInfoPanel();
    updateMap();
  });

  opacitySlider.addEventListener('input', () => {
    setLayerOpacity(opacitySlider.value);
  });

  applyScaleBtn.addEventListener('click', () => updateMap());
  styleSelect.addEventListener('change', () => { syncPaletteEnabled(); updateMap(); });
  paletteSelect.addEventListener('change', () => updateMap());

  portalSelect.addEventListener('change', (e) => {
    const next = String(e.target.value || '').trim().toLowerCase();
    if (!next || next === requestedPortalId) return;
    const url = new URL(window.location.href);
    url.searchParams.set('portal', next);
    window.location.href = url.toString();
  });

  metadataBtn.addEventListener('click', () => {
    if (!state.currentDataset) return alert('Please select a dataset first');
    window.open(`${state.currentDataset.wmsBase}?service=WMS&request=GetCapabilities&version=${encodeURIComponent(WMS_VERSION)}`, '_blank');
  });

  crsSelect.addEventListener('change', () => {
    const wanted = crsSelect.value;
    if (!setMapProjection(wanted)) {
      setStatus(`Unknown CRS: ${wanted}`, true);
      crsSelect.value = getCurrentCrs();
      return;
    }
    fitMapToBbox4326(state.selectedLayer?.bbox4326 || DEFAULT_CANADA_BBOX_4326);
    updateMap();
  });

  subsetFullTime.addEventListener('change', () => {
    if (subsetFullTime.checked) subsetCurrentTime.checked = false;
    normalizeSubsetTimeSelection();
    syncSubsetTimeRangeVisibility();
    updateSubsetTimeInputsEnabled();
  });

  subsetCurrentTime.addEventListener('change', () => {
    if (subsetCurrentTime.checked) subsetFullTime.checked = false;
    normalizeSubsetTimeSelection();
    syncSubsetTimeRangeVisibility();
    updateSubsetTimeInputsEnabled();
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