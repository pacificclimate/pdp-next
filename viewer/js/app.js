import {
  TIME_EXPAND_LIMIT,
  NCSS_WARN_TIMESTEPS,
  DEFAULT_VARIABLE_LABELS,
  CRS_OPTIONS,
  DEFAULT_CANADA_BBOX_4326,
  buildDefaultPortalConfig,
  readPortalId,
  readDefaultPortalId,
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
  subsetFullTime,
  subsetCurrentTime,
  subsetTimeStart,
  subsetTimeEnd,
  subsetSpatialMode,
  setStatus,
  startStatusSpinner,
  stopStatusSpinner,
  suppressStatusUpdates,
  unsuppressStatusUpdates,
  forceSetStatus,
} from "./core/dom.js";

("use strict");

const requestedPortalId = readPortalId();
const resolvedPortalId = requestedPortalId || readDefaultPortalId();
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
  subset: {
    useFullTime: true,
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
    subsetFullTime,
    subsetCurrentTime,
    subsetTimeStart,
    subsetTimeEnd,
  },
  services: {
    fetchText,
  },
  config: {
    TIME_EXPAND_LIMIT,
  },
});

const {
  parseWmsCapabilities,
  deriveTimesFromLayerDetails,
  fetchLayerTimesteps,
  getSelectedTime,
  getSelectedTimeIndex,
  getSelectedTimeLabel,
  hasMultipleTimes,
  normalizeSubsetTimeSelection,
  syncSubsetTimeRangeVisibility,
  updateTimeUI,
  toDateInputValue,
  parseSubsetDateValue,
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
  populateCrsSelect,
} = mapController;

const refreshInfoPanel = () =>
  updateInfoPanel(datasetName, variableInfo, timeInfo);

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
    deriveTimesFromLayerDetails,
    fetchLayerTimesteps,
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
    subsetFullTime,
    subsetCurrentTime,
    subsetTimeStart,
    subsetTimeEnd,
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
    getSelectedTime,
    parseSubsetDateValue,
  },
  mapDeps: {
    map,
    olRef: ol,
    subsetDrawSource,
    subsetDrawLayer,
    getCurrentCrs,
  },
  NCSS_WARN_TIMESTEPS,
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
  requestedPortalId,
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
  fitMapToBbox4326,
  setSubsetDrawMode,
  clearSubsetDrawing,
  downloadSubset,
});

updateViewerTitle();
populatePortalSelect();
populateCrsSelect(CRS_OPTIONS);
fitMapToBbox4326(DEFAULT_CANADA_BBOX_4326);
subsetSpatialMode.value = state.subset.spatialMode;
setSubsetDrawMode(state.subset.spatialMode);
updateSubsetTimeInputsEnabled();
setActiveGroup(state.groupId).catch((err) => {
  console.error(err);
  setStatus(`Error: ${err.message}`, true);
});
