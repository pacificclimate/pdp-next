import { WMS_VERSION, PALETTE_LABELS } from "../core/config.js";

const PRECIP_VARIABLE_NAMES = new Set([
  "pr",
  "ppt",
  "prec",
  "precip",
  "precipitation",
  "rainf",
]);
const ANNUAL_FREQUENCY_HINT_RE = /\b(year|yearly|annual|ann|yr)\b/;

export function createMapController({
  portal,
  state,
  olRef,
  proj4Ref,
  ui,
  services,
  time,
  variableLabel,
}) {
  const {
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
  } = ui;
  const { setStatus, fetchText } = services;
  const { getSelectedTime, getSelectedTimeLabel } = time;
  const MIN_WMS_COLOR_BANDS = 2;
  const MAX_WMS_COLOR_BANDS = 254;
  proj4Ref.defs(
    "EPSG:3005",
    "+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs",
  );
  proj4Ref.defs(
    "EPSG:3978",
    "+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs",
  );
  olRef.proj.proj4.register(proj4Ref);

  const epsg3005 = olRef.proj.get("EPSG:3005");
  epsg3005?.setExtent([-3000000, -2200000, 3200000, 3200000]);
  const epsg3978 = olRef.proj.get("EPSG:3978");
  epsg3978?.setExtent([-6000000, -5000000, 6000000, 6000000]);

  (function registerCrs84() {
    const epsg4326 = olRef.proj.get("EPSG:4326");
    const extent = epsg4326?.getExtent?.() || [-180, -90, 180, 90];
    const proj84 = new olRef.proj.Projection({
      code: "CRS:84",
      units: "degrees",
      extent,
      axisOrientation: "enu",
      global: true,
    });
    olRef.proj.addProjection(proj84);
    olRef.proj.addCoordinateTransforms(
      "CRS:84",
      "EPSG:4326",
      (c) => c,
      (c) => c,
    );

    const targets = ["EPSG:3857", "EPSG:3005", "EPSG:3978"];
    for (const t of targets) {
      const fwd = olRef.proj.getTransform("EPSG:4326", t);
      const inv = olRef.proj.getTransform(t, "EPSG:4326");
      if (typeof fwd === "function" && typeof inv === "function") {
        olRef.proj.addCoordinateTransforms("CRS:84", t, fwd, inv);
        olRef.proj.addCoordinateTransforms(t, "CRS:84", inv, fwd);
      }
    }
  })();

  const baseLayer = new olRef.layer.Tile({
    source: new olRef.source.OSM(),
    visible: true,
  });
  const DEFAULT_VIEW_CENTER_LONLAT = [-95, 62];
  let currentCrs = String(portal.defaultCrs || "EPSG:3857").toUpperCase();
  let mapView = new olRef.View({
    projection: currentCrs,
    center: olRef.proj.transform(
      DEFAULT_VIEW_CENTER_LONLAT,
      "EPSG:4326",
      currentCrs,
    ),
    zoom: 3,
  });
  const map = new olRef.Map({
    target: "map",
    layers: [baseLayer],
    view: mapView,
  });
  const subsetDrawSource = new olRef.source.Vector();
  const subsetDrawLayer = new olRef.layer.Vector({
    source: subsetDrawSource,
    visible: false,
  });
  subsetDrawLayer.setZIndex(1000); // Force subset drawing layer to be on top of WMS layer
  map.addLayer(subsetDrawLayer);
  let wmsLayer = null;

  function validExtent(extent) {
    return (
      Array.isArray(extent) &&
      extent.length === 4 &&
      extent.every(Number.isFinite) &&
      extent[0] <= extent[2] &&
      extent[1] <= extent[3]
    );
  }

  function captureViewExtent4326(projection) {
    const size = map.getSize();
    if (!size) return null;
    const extent = map.getView().calculateExtent(size);
    if (!validExtent(extent)) return null;
    const geographicExtent = olRef.proj.transformExtent(
      extent,
      projection,
      "EPSG:4326",
      8,
    );
    return validExtent(geographicExtent) ? geographicExtent : null;
  }

  function reprojectSubsetFeatures(previousCrs, nextCrs) {
    subsetDrawSource.getFeatures().forEach((feature) => {
      const geometry = feature.getGeometry();
      if (!geometry) return;
      let sourceGeometry = feature.get("selectionGeometry");
      let sourceCrs = feature.get("selectionCrs");
      if (!sourceGeometry?.clone || !sourceCrs) {
        sourceGeometry = geometry.clone();
        sourceCrs = previousCrs;
        feature.set("selectionGeometry", sourceGeometry.clone(), true);
        feature.set("selectionCrs", sourceCrs, true);
      }
      feature.setGeometry(sourceGeometry.clone().transform(sourceCrs, nextCrs));
    });
  }

  function setMapProjection(nextCrs) {
    const code = String(nextCrs || "")
      .trim()
      .toUpperCase();
    if (!olRef.proj.get(code)) return false;
    if (code === currentCrs) return true;
    const previousCrs = currentCrs;
    const previousViewExtent = captureViewExtent4326(previousCrs);
    reprojectSubsetFeatures(previousCrs, code);
    currentCrs = code;
    const nextCenter = olRef.proj.transform(
      DEFAULT_VIEW_CENTER_LONLAT,
      "EPSG:4326",
      currentCrs,
    );
    mapView = new olRef.View({
      projection: currentCrs,
      center: nextCenter,
      zoom: 3,
    });
    map.setView(mapView);
    if (previousViewExtent) {
      const projectedViewExtent = olRef.proj.transformExtent(
        previousViewExtent,
        "EPSG:4326",
        currentCrs,
        8,
      );
      if (validExtent(projectedViewExtent)) {
        mapView.fit(projectedViewExtent, {
          padding: [0, 0, 0, 0],
          duration: 0,
        });
      }
    }
    return true;
  }

  function formatLegendValue(value) {
    if (value === null || value === undefined) return "Auto";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function formatScaleInputValue(value) {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) >= 1000 || Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(3)));
  }

  function normalizeColorBandCount(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(
      MAX_WMS_COLOR_BANDS,
      Math.max(MIN_WMS_COLOR_BANDS, parsed),
    );
  }

  function styleSupportsPalette(styleBase) {
    const denied = state.layerDetails?.noPaletteStyles || [];
    return styleBase !== "contours" && !denied.includes(styleBase);
  }

  function syncPaletteEnabled() {
    const enabled = styleSupportsPalette(styleSelect.value);
    paletteSelect.disabled = !enabled;
  }

  function getPaletteDisplayName(name) {
    return PALETTE_LABELS[name] || name;
  }

  function populatePaletteSelect(palettes, defaultPalette) {
    paletteSelect.innerHTML = "";
    const ordered = [];
    palettes.forEach((p) => {
      if (!ordered.includes(p)) ordered.push(p);
    });
    if (defaultPalette && ordered.includes(defaultPalette)) {
      ordered.splice(ordered.indexOf(defaultPalette), 1);
      ordered.unshift(defaultPalette);
    }
    ordered.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = getPaletteDisplayName(p);
      paletteSelect.appendChild(opt);
    });
    paletteSelect.value = ordered.includes(defaultPalette)
      ? defaultPalette
      : ordered[0] || "default";
  }

  function pickDefaultPaletteForVar(varCode, palettes, fallback) {
    const divergingPriority = [
      "div-RdBu-inv",
      "div-Spectral",
      "psu-viridis",
      "seq-YlOrRd",
    ];
    const priority = {
      pr: ["seq-GnBu", "seq-Blues", "seq-BuGn", "psu-viridis", "default"],
      tas: divergingPriority,
      tasmax: divergingPriority,
      tasmin: divergingPriority,
      tmax: divergingPriority,
      tmin: divergingPriority,
    };
    const want = priority[String(varCode || "").toLowerCase()] || ["default"];
    for (const p of want) {
      if (palettes.includes(p)) return p;
    }
    return fallback || palettes[0] || "default";
  }

  async function fetchLayerDetails(wmsBase, layerName) {
    const url = `${wmsBase}?request=GetMetadata&item=layerDetails&layerName=${encodeURIComponent(
      layerName,
    )}`;
    const txt = await fetchText(url);
    try {
      return JSON.parse(txt);
    } catch {
      throw new Error("Could not parse layerDetails JSON from GetMetadata.");
    }
  }

  function deriveScaleRangeFromMetadata(details) {
    const meta = details?.metadata;
    if (!meta || typeof meta !== "object") return null;
    const json = JSON.stringify(meta);
    const minMatch = json.match(
      /"(?:minvalue|minimum|min|lower|lo|data_min|actual_min)"\s*:\s*([-+0-9.eE]+)/i,
    );
    const maxMatch = json.match(
      /"(?:maxvalue|maximum|max|upper|hi|data_max|actual_max)"\s*:\s*([-+0-9.eE]+)/i,
    );
    const min = minMatch ? parseFloat(minMatch[1]) : null;
    const max = maxMatch ? parseFloat(maxMatch[1]) : null;
    if (Number.isFinite(min) || Number.isFinite(max)) {
      return {
        min: Number.isFinite(min) ? min : null,
        max: Number.isFinite(max) ? max : null,
      };
    }
    return null;
  }

  function applyLayerScaleDefaults(range) {
    state.metadataRange = range || null;
    scaleMin.value =
      range?.min != null ? formatScaleInputValue(Number(range.min)) : "";
    scaleMax.value =
      range?.max != null ? formatScaleInputValue(Number(range.max)) : "";
  }

  function getLegendDisplayTitle() {
    const variable = String(state.variable || state.selectedLayer?.name || "").trim();
    const variableLabel = variable ? `${variable.charAt(0).toUpperCase()}${variable.slice(1)}` : "";
    const rawUnits = String(state.currentDataset?.metadata?.primary?.units || "").trim();
    const units = /^celsius$/i.test(rawUnits) ? "°C" : rawUnits;
    const timeCount = Number(state.currentDataset?.timeMetadata?.count || state.times?.length || 0);
    const period =
      timeCount === 1 ? "Annual " : timeCount === 12 ? "Monthly " : timeCount === 4 ? "Seasonal " : "";
    return `${period}${variableLabel}${units ? ` (${units})` : ""}` || "—";
  }

  function updateLegend(styleName, palette, min, max, bands, supportsPalette) {
    if (
      !legendPanel ||
      !legendImage ||
      !state.currentDataset ||
      !state.selectedLayer
    )
      return;
    const params = new URLSearchParams({
      request: "GetLegendGraphic",
      service: "WMS",
      version: WMS_VERSION,
      format: "image/png",
      width: "122",
      height: "400",
      transparent: "true",
      layer: state.selectedLayer.name,
      style: styleName,
    });
    if (supportsPalette) {
      params.set("PALETTE", palette);
      params.set("NUMCOLORBANDS", String(bands));
      params.set("BELOWMINCOLOR", "transparent");
      params.set("ABOVEMAXCOLOR", "0x202020");
    }
    if (min != null && max != null)
      params.set("COLORSCALERANGE", `${min},${max}`);
    legendImage.src = `${state.currentDataset.wmsBase}?${params.toString()}`;
    legendTitle.textContent = getLegendDisplayTitle();
    legendMin.textContent = formatLegendValue(min);
    legendMax.textContent = formatLegendValue(max);
    legendPanel.classList.remove("hidden");
  }

  function variableIcon(variableName, displayLabel) {
    const metadata = state.currentDataset?.metadata?.primary || {};
    const identity = [
      variableName,
      displayLabel,
      metadata.long_name,
      metadata.standard_name,
    ].filter(Boolean).join(" ").toLowerCase().replaceAll("_", " ");
    if (/\b(tas|max(?:imum)? temperature|min(?:imum)? temperature|temperature)\b/.test(identity)) {
      return {
        kind: "temperature",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z"/><path d="M11 7v10"/></svg>',
      };
    }
    if (/\b(snow|swe)\b/.test(identity)) {
      return {
        kind: "snow",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v20M4 7l16 10M20 7 4 17M8.5 4 12 7.5 15.5 4M8.5 20l3.5-3.5 3.5 3.5"/></svg>',
      };
    }
    if (/\bglac(?:ier)?\b/.test(identity)) {
      return {
        kind: "glacier",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m3 19 6-12 3 5 2-3 7 10H3Z"/><path d="m7.5 10 2 1 1.5-1M3 19c3-2 5 2 8 0s5 2 10 0"/></svg>',
      };
    }
    if (/\b(soil moisture|soil moist)\b/.test(identity)) {
      return {
        kind: "soil",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 8h18M3 13h18M3 18h18"/><path d="M12 2s-3 3.2-3 5.5a3 3 0 0 0 6 0C15 5.2 12 2 12 2Z"/></svg>',
      };
    }
    if (/\b(evap|evaporation|evapotranspiration|transpiration|pet)\b/.test(identity)) {
      return {
        kind: "evaporation",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 21v-8M12 16c-4 0-6-2-6-6 4 0 6 2 6 6ZM12 13c0-4 2-6 6-6 0 4-2 6-6 6Z"/><path d="M5 5c1-1 1-2 0-3M10 5c1-1 1-2 0-3"/></svg>',
      };
    }
    if (/\b(baseflow|runoff|outflow|flow)\b/.test(identity)) {
      return {
        kind: "flow",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 8c3-2 5 2 8 0s5 2 10 0M3 13c3-2 5 2 8 0s5 2 10 0M3 18c3-2 5 2 8 0s5 2 10 0"/></svg>',
      };
    }
    if (isPrecipVariable(variableName) || /\b(precipitation|rainfall|rain)\b/.test(identity)) {
      return {
        kind: "precipitation",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2S5.5 9.3 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 9.3 12 2 12 2Z"/></svg>',
      };
    }
    return {
      kind: "generic",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/></svg>',
    };
  }

  function updateInfoPanel(datasetName, variableInfo, timeInfo, variableIconElement) {
    const datasetParts = [portal.title, state.currentDataset?.selectionLabel]
      .filter(Boolean);
    datasetName.textContent = datasetParts.join(" · ") || "—";
    datasetName.title = [
      ...datasetParts,
      state.currentDataset?.urlPath,
    ].filter(Boolean).join("\n");
    const displayVariable = state.variable
      ? variableLabel(state.variable, state.group)
      : "—";
    variableInfo.textContent = displayVariable;
    if (variableIconElement) {
      const icon = variableIcon(state.variable, displayVariable);
      variableIconElement.dataset.kind = icon.kind;
      variableIconElement.innerHTML = icon.svg;
    }
    timeInfo.textContent = getSelectedTimeLabel();
  }

  function pickBestCrsForLayer(layer) {
    const supported = new Set((layer?.srs || []).map((s) => s.toUpperCase()));
    const portalDefault = String(portal.defaultCrs || "").toUpperCase();
    const prefs = [
      portalDefault,
      "EPSG:3005",
      "EPSG:3978",
      "EPSG:3857",
      "CRS:84",
      "EPSG:4326",
    ];
    for (const p of prefs) if (supported.has(p)) return p;
    return supported.values().next().value || "EPSG:3857";
  }

  function pickRequestCrsForLayer(layer, wantedCrs) {
    const supported = new Set((layer?.srs || []).map((s) => s.toUpperCase()));
    const wanted = String(wantedCrs || "").toUpperCase();
    if (supported.has(wanted)) return wanted;
    return pickBestCrsForLayer(layer) || wanted || "EPSG:3857";
  }

  function isPrecipVariable(varName) {
    const value = String(varName || "").trim().toLowerCase();
    return PRECIP_VARIABLE_NAMES.has(value);
  }

  function getLogScaleMinFloor() {
    const variableName =
      state.currentDataset?.rendering?.variable || state.variable || "";
    if (!isPrecipVariable(variableName)) return 1e-12;

    const timeCount = Number(state.currentDataset?.timeMetadata?.count || 0);
    const frequencyHints = [
      state.currentDataset?.rendering?.frequencyLabel,
      state.currentDataset?.name,
      state.currentDataset?.urlPath,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return ANNUAL_FREQUENCY_HINT_RE.test(frequencyHints) || timeCount === 1
      ? 200
      : 1;
  }

  function updateMap() {
    if (!state.currentDataset || !state.selectedLayer) return;
    if (wmsLayer) map.removeLayer(wmsLayer);
    let time = getSelectedTime();
    if (typeof time === "string" && time.includes(","))
      time = time.split(",")[0].trim();
    const opacity = parseInt(opacitySlider.value, 10) / 100;
    const styleBase = styleSelect?.value || "default-scalar";
    const palette = paletteSelect.value;
    const supportsPalette = styleSupportsPalette(styleBase);
    const styleName = supportsPalette ? `${styleBase}/${palette}` : styleBase;
    const manualMin = scaleMin?.value ? parseFloat(scaleMin.value) : null;
    const manualMax = scaleMax?.value ? parseFloat(scaleMax.value) : null;
    const metadataRange = state.metadataRange || {};
    const min = manualMin != null ? manualMin : metadataRange.min ?? null;
    const max = manualMax != null ? manualMax : metadataRange.max ?? null;
    if (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      Number(min) >= Number(max)
    ) {
      setStatus("Min value must be less than max value.", true);
      return;
    }
    const hasExplicitRange = Number.isFinite(min) && Number.isFinite(max);
    const shouldLogScale = Boolean(
      state.currentDataset?.rendering?.logScale && hasExplicitRange,
    );
    const bands = normalizeColorBandCount(numColors?.value);
    if (numColors) numColors.value = String(bands);
    const requestCrs = pickRequestCrsForLayer(state.selectedLayer, currentCrs);
    const params = {
      LAYERS: state.selectedLayer.name,
      STYLES: styleName,
      FORMAT: "image/png",
      TRANSPARENT: true,
      VERSION: WMS_VERSION,
      CRS: requestCrs,
    };
    if (time !== "—" && state.times.length > 1) params.TIME = time;
    if (supportsPalette) {
      params.PALETTE = palette;
      params.NUMCOLORBANDS = bands;
      const safeMin =
        shouldLogScale && min != null ? Math.max(min, getLogScaleMinFloor()) : min;
      if (safeMin != null && max != null)
        params.COLORSCALERANGE = `${safeMin},${max}`;
      if (shouldLogScale) params.LOGSCALE = "true";
      params.BELOWMINCOLOR = "transparent";
      params.ABOVEMAXCOLOR = "0x202020";
    }
    wmsLayer = new olRef.layer.Tile({
      opacity,
      source: new olRef.source.TileWMS({
        url: state.currentDataset.wmsBase,
        params,
        projection: requestCrs,
        hidpi: false,
        wrapX: false,
      }),
    });
    map.addLayer(wmsLayer);
    setStatus("Loading map image…");
    const src = wmsLayer.getSource();
    src.on("tileloadend", () => setStatus("Ready"));
    src.on("tileloaderror", (evt) => {
      try {
        const tile = evt?.tile?.getImage?.();
        console.error("WMS tile load error:", tile?.src || "");
      } catch {
        /* best-effort. img.src logging should never block error handling */
      }
      setStatus("WMS tile load error", true);
    });
    const legendMinValue =
      shouldLogScale && min != null ? Math.max(min, getLogScaleMinFloor()) : min;
    updateLegend(
      styleName,
      palette,
      legendMinValue,
      max,
      bands,
      supportsPalette,
    );
  }

  function setLayerOpacity(opacityPercent) {
    if (!wmsLayer) return;
    wmsLayer.setOpacity(parseInt(opacityPercent, 10) / 100);
  }

  function fitMapToBbox4326(bbox) {
    if (!bbox) return false;
    const { west, south, east, north } = bbox;
    if (![west, south, east, north].every(Number.isFinite)) return false;
    const extent = olRef.proj.transformExtent(
      [west, south, east, north],
      "EPSG:4326",
      currentCrs,
    );
    if (!extent || extent.some((v) => !Number.isFinite(v))) return false;
    map
      .getView()
      .fit(extent, { padding: [20, 20, 20, 20], maxZoom: 7, duration: 0 });
    return true;
  }

  function getViewBbox4326() {
    const extent = captureViewExtent4326(currentCrs);
    if (!extent) return null;
    const [west, south, east, north] = extent;
    return { west, south, east, north };
  }

  function populateCrsSelect(CRS_OPTIONS) {
    CRS_OPTIONS.forEach(({ code, label }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label;
      crsSelect.appendChild(opt);
    });
    crsSelect.value = currentCrs;
  }

  return {
    map,
    subsetDrawSource,
    subsetDrawLayer,
    getCurrentCrs: () => currentCrs,
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
  };
}
