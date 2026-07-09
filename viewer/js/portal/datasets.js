import {
  WMS_VERSION,
  FALLBACK_PALETTES,
  DEFAULT_CANADA_BBOX_4326,
} from "../core/config.js";

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
    deriveTimesFromLayerDetails,
    fetchLayerTimesteps,
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
  const { refreshInfoPanel, updateMap } = render;

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

  function ncpartitionerBase() {
    return "/pdp-next/ncpartitioner/";
  }

  function normalizePortalTimeValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const isoLike = raw.includes("T") ? raw : raw.replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(isoLike)
      ? isoLike
      : `${isoLike}Z`;
    const dt = new Date(withZone);
    return Number.isNaN(dt.getTime()) ? raw : dt.toISOString();
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

  function syncCrsForLayer() {
    if (olRef.proj.get(getCurrentCrs())) {
      crsSelect.value = getCurrentCrs();
    } else {
      const best = pickBestCrsForLayer(state.selectedLayer);
      if (olRef.proj.get(best)) {
        setMapProjection(best);
        crsSelect.value = best;
      }
    }
    fitMapToBbox4326(state.selectedLayer?.bbox4326 || DEFAULT_CANADA_BBOX_4326);
  }

  function applyTimesToUI() {
    timeSlider.value = String(Math.max(0, state.times.length - 1));
    updateTimeUI();
  }

  function setSubsetTimeInputs(start, end) {
    if (start) subsetTimeStart.value = toDateInputValue(start);
    if (end) subsetTimeEnd.value = toDateInputValue(end);
  }

  function initTimesFromLayer(timeMetadata) {
    const timeStart = state.selectedLayer.time?.start || "";
    const timeEnd = state.selectedLayer.time?.end || "";
    subsetTimeStart.value = timeStart ? toDateInputValue(timeStart) : "";
    subsetTimeEnd.value = timeEnd ? toDateInputValue(timeEnd) : "";
    state.times = Array.isArray(state.selectedLayer.time?.times)
      ? state.selectedLayer.time.times
      : [];
    if (
      !state.times.length &&
      Number(timeMetadata?.count || 0) === 1 &&
      timeMetadata?.start
    ) {
      const singleTime = normalizePortalTimeValue(timeMetadata.start);
      if (singleTime) {
        state.times = [singleTime];
        setSubsetTimeInputs(singleTime, singleTime);
      }
    }
    applyTimesToUI();
  }

  async function expandTimesFromDetails(details) {
    if (state.times.length > 1) return;
    const detailTimes = deriveTimesFromLayerDetails(details);
    if (detailTimes.times.length > state.times.length) {
      state.times = detailTimes.times;
      setSubsetTimeInputs(detailTimes.start, detailTimes.end);
      applyTimesToUI();
    }
  }

  async function expandTimesFromMetadata() {
    if (state.times.length > 1) return;
    const metadataTimes = await fetchLayerTimesteps(
      state.currentDataset.wmsBase,
      state.selectedLayer.name,
    );
    if (metadataTimes.times.length > state.times.length) {
      state.times = metadataTimes.times;
      setSubsetTimeInputs(metadataTimes.start, metadataTimes.end);
      applyTimesToUI();
    }
  }

  function overrideSingleTimeFromMetadata(timeMetadata) {
    if (Number(timeMetadata?.count || 0) !== 1 || !timeMetadata?.start) return;
    const singleTime = normalizePortalTimeValue(timeMetadata.start);
    if (!singleTime) return;
    state.times = [singleTime];
    subsetTimeStart.value = toDateInputValue(singleTime);
    subsetTimeEnd.value = toDateInputValue(singleTime);
    timeSlider.value = "0";
    updateTimeUI();
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
    urlPath,
    variable,
    metadata = null,
    rendering = null,
    timeMetadata = null,
  }) {
    try {
      cancelPendingSubsetStatus?.();
      stopStatusSpinner();
      setStatus("Loading dataset…");
      legendPanel?.classList.add("hidden");
      state.currentDataset = {
        name,
        urlPath,
        wmsBase: wmsBaseForUrlPath(urlPath),
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
      syncCrsForLayer();
      initTimesFromLayer(timeMetadata);

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

      await expandTimesFromDetails(details);
      await expandTimesFromMetadata();
      overrideSingleTimeFromMetadata(timeMetadata);

      applyPaletteAndScale(details, rendering);
      refreshInfoPanel();
      updateMap();
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
