import "ol/ol.css";
import "../viewer.css";
import proj4 from "proj4";
import { ol } from "./core/openlayers.js";
import {
  DEFAULT_VARIABLE_LABELS,
  applyDisplayLabels,
  CRS_OPTIONS,
  DEFAULT_CANADA_BBOX_4326,
  buildDefaultPortalConfig,
  buildViewerUrl,
  readPortalId,
  readDefaultPortalId,
  readViewerUrlState,
} from "./core/config.js";
import { createTimeController } from "./time.js";
import { createMenuController } from "./portal/menu.js";
import { createMapController } from "./map/controller.js";
import { createSubsettingController } from "./subsetting.js";
import {
  createDatasetController,
  variableLabelForGroup,
} from "./portal/datasets.js";
import { wireEvents } from "./events.js";
import {
  timeModeBtns,
  opacitySlider,
  timeSlider,
  timeSliderContainer,
  timeValue,
  datasetName,
  variableInfo,
  selectionVariableIcon,
  timeInfo,
  paletteSelect,
  scaleMin,
  scaleMax,
  numColors,
  styleSelect,
  legendPanel,
  legendImage,
  legendTitle,
  legendMin,
  legendMax,
  viewerTitleElement,
  portalSelect,
  datasetMenu,
  crsSelect,
  subsetTimeModeFull,
  subsetTimeModeCurrent,
  subsetTimeModeRange,
  subsetTimeModeInputs,
  subsetTimeStart,
  subsetTimeEnd,
  subsetSpatialMode,
  setStatus,
  startStatusSpinner,
  stopStatusSpinner,
  subsetDownloadBtn,
  suppressStatusUpdates,
  unsuppressStatusUpdates,
  forceSetStatus,
} from "./core/dom.js";

("use strict");

const requestedPortalId = readPortalId();
const resolvedPortalId = requestedPortalId || readDefaultPortalId();
const initialUrlState = readViewerUrlState();
let portal = buildDefaultPortalConfig(resolvedPortalId);

let groups = Array.isArray(portal.groups) ? portal.groups : [];
if (!groups.length) {
  groups = buildDefaultPortalConfig(portal.id).groups;
  portal.groups = groups;
}

function normalizeKey(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function normalizeCfTimestamp(value) {
  return String(value || '').trim().replace(/\.0+Z$/, 'Z');
}

function getGroupById(id) {
  const key = normalizeKey(id);
  return groups.find((g) => normalizeKey(g.id) === key) || null;
}

const initialGroupId = groups[0]?.id;
const state = {
  groupId: initialGroupId,
  group: getGroupById(initialGroupId),
  currentDataset: null,
  selectedLayer: null,
  layers: [],
  times: [],
  variable: null,
  layerDetails: null,
  metadataRange: null,
  ncpIndexCache: {},
  timeCoordinateCache: {},
  subset: {
    timeMode: "full",
    timeStart: "",
    timeEnd: "",
    spatialMode: "whole",
  },
};

function updateViewerTitle() {
  if (!viewerTitleElement) return;
  viewerTitleElement.textContent = portal.title || portal.id;
  document.title = portal.title || portal.id;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const timeController = createTimeController({
  state,
  ui: {
    timeModeBtns,
    timeSlider,
    timeSliderContainer,
    timeValue,
    subsetTimeModeFull,
    subsetTimeModeCurrent,
    subsetTimeModeRange,
    subsetTimeModeInputs,
    subsetTimeStart,
    subsetTimeEnd,
  },
});

const {
  parseWmsCapabilities,
  getSubsetTimeMode,
  getSelectedTime,
  getSelectedTimeIndex,
  getSelectedTimeLabel,
  hasMultipleTimes,
  normalizeSubsetTimeSelection,
  syncSubsetTimeRangeVisibility,
  updateTimeUI,
  toDateInputValue,
  updateSubsetTimeInputsEnabled,
} = timeController;

const variableLabel = (varCode, group) =>
  variableLabelForGroup(varCode, group, DEFAULT_VARIABLE_LABELS);

const mapController = createMapController({
  portal,
  state,
  olRef: ol,
  proj4Ref: proj4,
  ui: {
    opacitySlider,
    paletteSelect,
    scaleMin,
    scaleMax,
    numColors,
    styleSelect,
    legendPanel,
    legendImage,
    legendTitle,
    legendMin,
    legendMax,
    crsSelect,
  },
  services: {
    setStatus,
    fetchText,
  },
  time: {
    getSelectedTime,
    getSelectedTimeLabel,
  },
  variableLabel,
});

const {
  map,
  subsetDrawSource,
  subsetDrawLayer,
  getCurrentCrs,
  setMapProjection,
  fetchLayerDetails,
  deriveScaleRangeFromMetadata,
  applyLayerScaleDefaults,
  syncPaletteEnabled,
  populatePaletteSelect,
  pickDefaultPaletteForVar,
  updateInfoPanel,
  pickBestCrsForLayer,
  updateMap,
  setLayerOpacity,
  fitMapToBbox4326,
  getViewBbox4326,
  populateCrsSelect,
} = mapController;

const refreshInfoPanel = () =>
  updateInfoPanel(datasetName, variableInfo, timeInfo, selectionVariableIcon);

let initialViewerStatePending = true;
let viewerUrlReady = false;
let viewerUrlTimer = null;

function selectHasValue(select, value) {
  return Array.from(select?.options || []).some((option) => option.value === value);
}

function applyInitialViewerState() {
  if (!initialViewerStatePending) return;

  if (initialUrlState.crs && ol.proj.get(initialUrlState.crs)) {
    setMapProjection(initialUrlState.crs);
    crsSelect.value = getCurrentCrs();
  }
  if (initialUrlState.style && selectHasValue(styleSelect, initialUrlState.style)) {
    styleSelect.value = initialUrlState.style;
  }
  if (initialUrlState.palette && selectHasValue(paletteSelect, initialUrlState.palette)) {
    paletteSelect.value = initialUrlState.palette;
  }
  if (initialUrlState.min !== null) scaleMin.value = String(initialUrlState.min);
  if (initialUrlState.max !== null) scaleMax.value = String(initialUrlState.max);
  if (initialUrlState.colors !== null) {
    numColors.value = String(Math.min(254, Math.max(2, initialUrlState.colors)));
  }
  if (initialUrlState.opacity !== null) {
    opacitySlider.value = String(
      Math.min(100, Math.max(0, initialUrlState.opacity)),
    );
  }
  if (initialUrlState.time) {
    const requestedTime = normalizeCfTimestamp(initialUrlState.time);
    const timeIndex = state.times.findIndex(
      (value) => normalizeCfTimestamp(value) === requestedTime,
    );
    if (timeIndex >= 0) timeSlider.value = String(timeIndex);
  }
  updateTimeUI();
  syncPaletteEnabled();

  if (initialUrlState.view) {
    const [west, south, east, north] = initialUrlState.view;
    fitMapToBbox4326({ west, south, east, north });
  }
  initialViewerStatePending = false;
}

function currentViewerUrlState() {
  const bbox = getViewBbox4326();
  const selectedTime = getSelectedTime();
  return {
    dataset: state.currentDataset?.urlPath || null,
    variable: state.selectedLayer?.name || state.variable,
    view: bbox ? [bbox.west, bbox.south, bbox.east, bbox.north] : null,
    crs: getCurrentCrs(),
    palette: paletteSelect.value,
    style: styleSelect.value,
    min: scaleMin.value === '' ? null : Number(scaleMin.value),
    max: scaleMax.value === '' ? null : Number(scaleMax.value),
    colors: Number(numColors.value),
    opacity: Number(opacitySlider.value),
    time: selectedTime === '—' ? null : selectedTime,
  };
}

function scheduleViewerUrlSync() {
  if (!viewerUrlReady || !state.currentDataset) return;
  if (viewerUrlTimer) window.clearTimeout(viewerUrlTimer);
  viewerUrlTimer = window.setTimeout(() => {
    const nextUrl = buildViewerUrl(
      resolvedPortalId,
      currentViewerUrlState(),
    );
    if (nextUrl !== window.location.href) {
      window.history.replaceState(null, '', nextUrl);
    }
    viewerUrlTimer = null;
  }, 120);
}

function markViewerUrlReady() {
  viewerUrlReady = true;
  scheduleViewerUrlSync();
}

map.on('moveend', scheduleViewerUrlSync);

let cancelPendingSubsetStatus = () => {};

const datasetController = createDatasetController({
  state,
  portal,
  olRef: ol,
  ui: {
    legendPanel,
    crsSelect,
    subsetTimeStart,
    subsetTimeEnd,
    timeSlider,
  },
  status: {
    setStatus,
    stopStatusSpinner,
    cancelPendingSubsetStatus: () => cancelPendingSubsetStatus(),
  },
  services: {
    fetchText,
  },
  time: {
    parseWmsCapabilities,
    fetchLayerDetails,
    updateTimeUI,
    toDateInputValue,
  },
  map: {
    getCurrentCrs,
    setMapProjection,
    pickBestCrsForLayer,
    fitMapToBbox4326,
  },
  layer: {
    deriveScaleRangeFromMetadata,
    applyLayerScaleDefaults,
    syncPaletteEnabled,
    populatePaletteSelect,
    pickDefaultPaletteForVar,
  },
  render: {
    refreshInfoPanel,
    updateMap,
    applyInitialViewerState,
    viewerStateChanged: markViewerUrlReady,
  },
});

const {
  threddsRoot,
  fileServerUrlForUrlPath,
  dodsBaseForUrlPath,
  ncpartitionerBase,
  loadDatasetFromUrlPath,
} = datasetController;

const menuController = createMenuController({
  portal,
  initialDatasetUrlPath: initialUrlState.dataset,
  initialVariable: initialUrlState.variable,
  ui: {
    datasetMenu,
    portalSelect,
  },
  services: {
    fetchJson,
    setStatus,
  },
  loadDatasetFromUrlPath,
});

const { renderMenuForGroup, populatePortalSelect } = menuController;

let clearSubsetDrawing = () => {};
let setSubsetDrawMode = () => {};
let downloadSubset = () => {};

const subsettingController = createSubsettingController({
  state,
  portal,
  ui: {
    subsetSpatialMode,
    subsetTimeModeFull,
    subsetTimeModeCurrent,
    subsetTimeModeRange,
    subsetTimeModeInputs,
    subsetTimeStart,
    subsetTimeEnd,
    subsetDownloadBtn,
  },
  status: {
    startStatusSpinner,
    stopStatusSpinner,
    setStatus,
    suppressStatusUpdates,
    unsuppressStatusUpdates,
    forceSetStatus,
  },
  services: {
    fetchText,
    fileServerUrlForUrlPath,
    dodsBaseForUrlPath,
    ncpartitionerBase,
    threddsRoot,
  },
  time: {
    getSubsetTimeMode,
    getSelectedTime,
  },
  mapDeps: {
    map,
    olRef: ol,
    subsetDrawSource,
    subsetDrawLayer,
    getCurrentCrs,
  }
});

({
  clearSubsetDrawing,
  setSubsetDrawMode,
  downloadSubset,
  cancelPendingSubsetStatus,
} = subsettingController);

async function setActiveGroup(groupId) {
  const next = getGroupById(groupId) || groups[0];
  state.groupId = next.id;
  state.group = next;
  await renderMenuForGroup(next);
}

wireEvents({
  state,
  activePortalId: resolvedPortalId,
  getSubsetTimeMode,
  getSelectedTimeIndex,
  getSelectedTimeLabel,
  hasMultipleTimes,
  updateTimeUI,
  normalizeSubsetTimeSelection,
  syncSubsetTimeRangeVisibility,
  updateSubsetTimeInputsEnabled,
  refreshInfoPanel,
  updateMap,
  setLayerOpacity,
  syncPaletteEnabled,
  setMapProjection,
  getCurrentCrs,
  setSubsetDrawMode,
  clearSubsetDrawing,
  downloadSubset,
  viewerStateChanged: scheduleViewerUrlSync,
});

async function initializeViewer() {
  try {
    applyDisplayLabels(await fetchJson('/pdp-next/portal-meta/display-labels.json'));
  } catch (err) {
    console.warn('Could not load display-labels.json; using raw identifiers:', err);
  }
  portal.title = buildDefaultPortalConfig(portal.id).title;
  updateViewerTitle();
  populatePortalSelect();
  populateCrsSelect(CRS_OPTIONS);
  if (initialUrlState.crs && ol.proj.get(initialUrlState.crs)) {
    setMapProjection(initialUrlState.crs);
    crsSelect.value = getCurrentCrs();
  }
  if (initialUrlState.view) {
    const [west, south, east, north] = initialUrlState.view;
    fitMapToBbox4326({ west, south, east, north });
  } else {
    fitMapToBbox4326(DEFAULT_CANADA_BBOX_4326);
  }
  subsetSpatialMode.value = state.subset.spatialMode;
  setSubsetDrawMode(state.subset.spatialMode);
  updateSubsetTimeInputsEnabled();
  await setActiveGroup(state.groupId);
}

initializeViewer().catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`, true);
});
