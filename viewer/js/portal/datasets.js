import {
  WMS_VERSION,
  FALLBACK_PALETTES,
  DEFAULT_CANADA_BBOX_4326,
} from "../core/config.js";
import { cfNumberToIso, normalizeCalendar } from "../time/cftime.js";
import { parseAsciiDimensionValues } from "../subsetting/indexes.js";

export function variableLabelForGroup(varCode, group, defaultLabels = {}) {
  const v = String(varCode || "");
  const fromGroup = group?.variable?.labels?.[v];
  return fromGroup || defaultLabels[v] || v;
}

export function createDatasetController({
  state,
  portal,
  olRef,
  ui,
  status,
  services,
  time,
  map: mapDeps,
  layer,
  render,
}) {
  const { legendPanel, crsSelect, subsetTimeStart, subsetTimeEnd, timeSlider } =
    ui;
  const { setStatus, stopStatusSpinner, cancelPendingSubsetStatus } = status;
  const { fetchText } = services;
  const {
    parseWmsCapabilities,
    fetchLayerDetails,
    updateTimeUI,
    toDateInputValue,
  } = time;
  const {
    getCurrentCrs,
    setMapProjection,
    pickBestCrsForLayer,
    fitMapToBbox4326,
  } = mapDeps;
  const {
    deriveScaleRangeFromMetadata,
    applyLayerScaleDefaults,
    syncPaletteEnabled,
    populatePaletteSelect,
    pickDefaultPaletteForVar,
  } = layer;
  const {
    refreshInfoPanel,
    updateMap,
    applyInitialViewerState,
    viewerStateChanged,
  } = render;

  function threddsRoot() {
    const root = String(portal.threddsRoot || "/thredds/");
    return root.endsWith("/") ? root : `${root}/`;
  }

  function fileServerUrlForUrlPath(urlPath) {
    return `${threddsRoot()}fileServer/${urlPath}`;
  }

  function wmsBaseForUrlPath(urlPath) {
    return `${threddsRoot()}wms/${urlPath}`;
  }

  function dodsBaseForUrlPath(urlPath) {
    return `${threddsRoot()}dodsC/${urlPath}`;
  }

  function ncmlUrlForUrlPath(urlPath) {
    return `${threddsRoot()}ncml/${urlPath}`;
  }

  function ncpartitionerBase() {
    return "/pdp-next/ncpartitioner/";
  }

  async function resolveLayersFromCapabilities() {
    const capsUrl = `${
      state.currentDataset.wmsBase
    }?service=WMS&request=GetCapabilities&version=${encodeURIComponent(
      WMS_VERSION,
    )}`;
    const capsText = await fetchText(capsUrl);
    const layers = parseWmsCapabilities(capsText);
    if (!layers.length) throw new Error("No layers found in GetCapabilities");
    const preferred = state.variable
      ? layers.find(
          (l) =>
            String(l.name || "")
              .trim()
              .toLowerCase() ===
            String(state.variable || "")
              .trim()
              .toLowerCase(),
        )
      : null;
    state.selectedLayer = preferred || layers[0];
    state.layers = layers;
    state.variable = state.selectedLayer?.name || state.variable;
  }

  function syncCrsForLayer({ fitToLayer = false } = {}) {
    if (olRef.proj.get(getCurrentCrs())) {
      crsSelect.value = getCurrentCrs();
    } else {
      const best = pickBestCrsForLayer(state.selectedLayer);
      if (olRef.proj.get(best)) {
        setMapProjection(best);
        crsSelect.value = best;
      }
    }
    if (fitToLayer) {
      fitMapToBbox4326(
        state.selectedLayer?.bbox4326 || DEFAULT_CANADA_BBOX_4326,
      );
    }
  }

  function applyTimesToUI() {
    timeSlider.value = String(Math.max(0, state.times.length - 1));
    updateTimeUI();
  }

  function setSubsetTimeInputs(start, end) {
    if (start) subsetTimeStart.value = toDateInputValue(start);
    if (end) subsetTimeEnd.value = toDateInputValue(end);
  }

  function usesCfTimeAxis(timeMetadata) {
    const calendar = normalizeCalendar(timeMetadata?.calendar);
    return Boolean(timeMetadata?.units && calendar);
  }

  async function replaceTimesWithCfCoordinates(timeMetadata) {
    if (!timeMetadata?.units) {
      throw new Error('Dataset metadata is missing CF time units');
    }
    if (!usesCfTimeAxis(timeMetadata)) {
      throw new Error(`Unsupported CF calendar: ${timeMetadata?.calendar || '(missing)'}`);
    }
    const key = String(state.currentDataset.urlPath || '');
    let values = state.timeCoordinateCache?.[key];
    if (!values) {
      const asciiUrl = `${dodsBaseForUrlPath(state.currentDataset.urlPath)}.ascii?time`;
      values = parseAsciiDimensionValues(await fetchText(asciiUrl), 'time');
      if (!values.length) throw new Error('Could not read the source CF time coordinate');
      state.timeCoordinateCache ||= {};
      state.timeCoordinateCache[key] = values;
    }
    const times = values.map((value) => cfNumberToIso(
      value,
      timeMetadata.units,
      timeMetadata.calendar,
    ));
    if (!times.length || times.some((value) => !value)) {
      throw new Error('Could not convert the source CF time coordinate');
    }
    state.times = times;
    setSubsetTimeInputs(times[0], times[times.length - 1]);
    applyTimesToUI();
  }

  function applyPaletteAndScale(details, rendering) {
    const paletteCandidates = details?.palettes?.length
      ? details.palettes
      : [...FALLBACK_PALETTES];
    const paletteDefault = pickDefaultPaletteForVar(
      state.variable,
      paletteCandidates,
      details?.defaultPalette || FALLBACK_PALETTES[0],
    );
    populatePaletteSelect(paletteCandidates, paletteDefault);
    const detailsRange = deriveScaleRangeFromMetadata(details);
    const fileRange =
      rendering &&
      Number.isFinite(rendering.min) &&
      Number.isFinite(rendering.max)
        ? { min: Number(rendering.min), max: Number(rendering.max) }
        : null;
    applyLayerScaleDefaults(fileRange || detailsRange);
    syncPaletteEnabled();
  }

  async function loadDatasetFromUrlPath({
    name,
    selectionLabel = null,
    urlPath,
    variable,
    variableLabel = null,
    metadata = null,
    rendering = null,
    timeMetadata = null,
  }) {
    try {
      const isInitialDataset = !state.currentDataset;
      cancelPendingSubsetStatus?.();
      stopStatusSpinner();
      setStatus("Loading dataset…");
      legendPanel?.classList.add("hidden");
      state.currentDataset = {
        name,
        selectionLabel,
        variableLabel,
        urlPath,
        wmsBase: wmsBaseForUrlPath(urlPath),
        ncmlUrl: ncmlUrlForUrlPath(urlPath),
        metadata,
        rendering,
        timeMetadata,
      };
      state.variable = variable || null;
      state.layers = [];
      state.selectedLayer = null;
      state.times = [];
      state.layerDetails = null;
      state.metadataRange = null;

      await resolveLayersFromCapabilities();
      syncCrsForLayer({ fitToLayer: isInitialDataset });
      let details = null;
      try {
        details = await fetchLayerDetails(
          state.currentDataset.wmsBase,
          state.selectedLayer.name,
        );
      } catch (err) {
        console.warn("layerDetails unavailable:", err?.message || err);
      }
      state.layerDetails = details;

      await replaceTimesWithCfCoordinates(timeMetadata);

      applyPaletteAndScale(details, rendering);
      applyInitialViewerState?.();
      refreshInfoPanel();
      updateMap();
      viewerStateChanged?.();
      setStatus("Ready");
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`, true);
    }
  }

  return {
    threddsRoot,
    fileServerUrlForUrlPath,
    wmsBaseForUrlPath,
    dodsBaseForUrlPath,
    ncpartitionerBase,
    loadDatasetFromUrlPath,
  };
}
