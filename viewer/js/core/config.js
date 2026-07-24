export const KNOWN_PORTALS = [
  // { id: 'gridded_daily', title: 'Daily Gridded Meteorological Datasets', mount: 'gridded_daily', defaultCrs: 'EPSG:4326' },
  { id: "prism", title: "BC PRISM", mount: "prism", defaultCrs: "EPSG:3005" },
  {
    id: "canada_mosaic",
    title: "Canada Mosaic",
    mount: "canada_mosaic",
    defaultCrs: "EPSG:3978",
  },
  {
    id: "vicgl",
    title: "Gridded Hydrologic Model Output (VICGL)",
    mount: "vicgl",
    defaultCrs: "EPSG:3005",
  },
  {
    id: "bccaqv2_u5",
    title: "CanDCS-U5 (BCCAQv2 CMIP5)",
    mount: "bccaqv2_u5",
    defaultCrs: "EPSG:4326",
  },
  {
    id: "bccaqv2_u6",
    title: "CanDCS-U6 (BCCAQv2 CMIP6)",
    mount: "bccaqv2_u6",
    defaultCrs: "EPSG:4326",
  },
  {
    id: "mbcn",
    title: "Canadian Downscaled Climate Scenarios (MBCn)",
    mount: "mbcn",
    defaultCrs: "EPSG:3978",
  },
  {
    id: "canesm5_u6",
    title: "CanESM5 (Univariate)",
    mount: "bccaqv2/canesm5",
    defaultCrs: "EPSG:4326",
  },
  {
    id: "canesm5_m6",
    title: "CanESM5 (Multivariate)",
    mount: "mbcn/canesm5_10",
    defaultCrs: "EPSG:3978",
  },
];

export const PORTAL_PARAM_KEY = "portal";
export const WMS_VERSION = "1.3.0";
export const TIME_EXPAND_LIMIT = 2000;
export const NCSS_WARN_TIMESTEPS = 1500;
export const DEFAULT_PORTAL_ID = "canada_mosaic";

export const PALETTE_LABELS = {
  default: "Default",
  "seq-Blues": "Sequential Blues",
  "seq-BuGn": "Sequential Blue-Green",
  "seq-GnBu": "Sequential Green-Blue",
  "seq-Greens": "Sequential Greens",
  "seq-YlOrRd": "Sequential Yellow-Orange-Red",
  "seq-OrRd": "Sequential Orange-Red",
  "seq-Reds": "Sequential Reds",
  "seq-Heat": "Sequential Heat",
  "seq-viridis": "Viridis (sequential)",
  "psu-viridis": "PSU Viridis",
  "div-Spectral": "Diverging Spectral",
  "div-RdBu": "Diverging Red \u2192 Blue",
  "div-RdBu-inv": "Diverging Blue \u2192 Red",
};

export const FALLBACK_PALETTES = Object.keys(PALETTE_LABELS);

export const DEFAULT_VARIABLE_LABELS = {
  pr: "Total Precipitation",
  tas: "Mean Temperature",
  tasmax: "Daily Maximum Temperature",
  tasmin: "Daily Minimum Temperature",
  tmax: "Maximum Temperature",
  tmin: "Minimum Temperature",
};

export const CRS_OPTIONS = [
  { code: "CRS:84", label: "CRS:84" },
  { code: "EPSG:4326", label: "EPSG:4326" },
  { code: "EPSG:3857", label: "EPSG:3857" },
  { code: "EPSG:3978", label: "EPSG:3978" },
  { code: "EPSG:3005", label: "EPSG:3005" },
];

export const DEFAULT_CANADA_BBOX_4326 = {
  west: -141,
  south: 41,
  east: -52,
  north: 84.5,
};

export function normalizePortalId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function isKnownPortalId(value) {
  const id = normalizePortalId(value);
  return !!id && KNOWN_PORTALS.some((portal) => portal.id === id);
}

export function buildDefaultPortalConfig(portalId) {
  const id = normalizePortalId(portalId);
  const known = KNOWN_PORTALS.find((portal) => portal.id === id);

  return {
    id,
    title: known?.title || id,
    mount: known?.mount || id,
    threddsRoot: "/pdp-next/thredds/",
    defaultCrs: known?.defaultCrs || "EPSG:3857",
    groups: [
      {
        id: "default",
        label: "Datasets",
        baseCatalogPath: `data/${known?.mount || id}`,
        files: { excludeAnySubstr: ["/derived/", "/Derived/", "derived/"] },
        variable: { fromFilename: { type: "prefix", toLowerCase: true } },
      },
    ],
  };
}

export function readPortalId() {
  const url = new URL(window.location.href);
  const raw = normalizePortalId(url.searchParams.get(PORTAL_PARAM_KEY));
  if (isKnownPortalId(raw)) return raw;
  const match = url.pathname.match(/\/portal(?:=|\/)([^/]+)\/?$/i);
  const pathPortalId = normalizePortalId(match?.[1]);
  if (isKnownPortalId(pathPortalId)) return pathPortalId;
  return null;
}

export function buildPortalUrl(portalId, href = window.location.href) {
  const id = normalizePortalId(portalId);
  const url = new URL(href);
  url.pathname = url.pathname.replace(/\/portal(?:=|\/)[^/]+\/?$/i, "/");
  url.search = "";
  if (id) url.searchParams.set(PORTAL_PARAM_KEY, id);
  return url.toString();
}

function finiteUrlNumber(value) {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readViewerUrlState(href = window.location.href) {
  const params = new URL(href).searchParams;
  const rawView = String(params.get("view") || "")
    .split(",")
    .map(finiteUrlNumber);
  const view =
    rawView.length === 4 &&
    rawView.every((value) => value !== null) &&
    rawView[0] < rawView[2] &&
    rawView[1] < rawView[3]
      ? rawView
      : null;
  const colors = finiteUrlNumber(params.get("colors"));
  const opacity = finiteUrlNumber(params.get("opacity"));

  return {
    dataset: String(params.get("dataset") || "").trim() || null,
    variable: String(params.get("variable") || "").trim() || null,
    view,
    crs:
      String(params.get("crs") || "")
        .trim()
        .toUpperCase() || null,
    palette: String(params.get("palette") || "").trim() || null,
    style: String(params.get("style") || "").trim() || null,
    min: finiteUrlNumber(params.get("min")),
    max: finiteUrlNumber(params.get("max")),
    colors: colors === null ? null : Math.round(colors),
    opacity: opacity === null ? null : Math.round(opacity),
    time: String(params.get("time") || "").trim() || null,
  };
}

function compactUrlNumber(value, precision = 6) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return String(Number(number.toFixed(precision)));
}

export function buildViewerUrl(
  portalId,
  viewerState,
  href = window.location.href,
) {
  const url = new URL(buildPortalUrl(portalId, href));
  const setString = (key, value) => {
    const text = String(value || "").trim();
    if (text) url.searchParams.set(key, text);
  };
  setString("dataset", viewerState?.dataset);
  setString("variable", viewerState?.variable);
  if (Array.isArray(viewerState?.view) && viewerState.view.length === 4) {
    const view = viewerState.view.map((value) => compactUrlNumber(value));
    if (view.every((value) => value !== null)) {
      url.searchParams.set("view", view.join(","));
    }
  }
  setString("crs", viewerState?.crs);
  setString("palette", viewerState?.palette);
  setString("style", viewerState?.style);
  const min = compactUrlNumber(viewerState?.min);
  const max = compactUrlNumber(viewerState?.max);
  const colors = compactUrlNumber(viewerState?.colors, 0);
  const opacity = compactUrlNumber(viewerState?.opacity, 0);
  if (min !== null) url.searchParams.set("min", min);
  if (max !== null) url.searchParams.set("max", max);
  if (colors !== null) url.searchParams.set("colors", colors);
  if (opacity !== null) url.searchParams.set("opacity", opacity);
  setString("time", viewerState?.time);
  return url.toString();
}

export function readDefaultPortalId() {
  const runtimeDefault = window.PDP_DEFAULT_PORTAL_ID;
  const candidate = normalizePortalId(runtimeDefault || DEFAULT_PORTAL_ID);
  if (!candidate) return null;
  return isKnownPortalId(candidate) ? candidate : DEFAULT_PORTAL_ID;
}
