export const KNOWN_PORTALS = [
  { id: 'gridded_daily', title: 'Daily Gridded Meteorological Datasets', mount: 'gridded_daily', defaultCrs: 'EPSG:4326' },
  { id: 'prism', title: 'PRISM', mount: 'prism', defaultCrs: 'EPSG:3005' },
  { id: 'canada_mosaic', title: 'Canada Mosaic 30arcsec', mount: 'canada_mosaic', defaultCrs: 'EPSG:4326' },
  { id: 'vicgl', title: 'Gridded Hydrologic Model Output (VICGL)', mount: 'vicgl', defaultCrs: 'EPSG:3005' },
  { id: 'bccaqv2_u5', title: 'CanDCS-U5 (BCCAQv2 CMIP5)', mount: 'bccaqv2_u5', defaultCrs: 'EPSG:4326' },
  { id: 'bccaqv2_u6', title: 'CanDCS-U6 (BCCAQv2 CMIP6)', mount: 'bccaqv2_u6', defaultCrs: 'EPSG:4326' },
  { id: 'mbcn', title: 'Canadian Downscaled Climate Scenarios (MBCn)', mount: 'mbcn', defaultCrs: 'EPSG:3978' },
  { id: 'canesm5_u6', title: 'CanESM5 (Univariate)', mount: 'bccaqv2/canesm5', defaultCrs: 'EPSG:4326' },
  { id: 'canesm5_m6', title: 'CanESM5 (Multivariate)', mount: 'mbcn/canesm5_10', defaultCrs: 'EPSG:3978' }
];

export const PORTAL_PARAM_KEY = 'portal';
export const WMS_VERSION = '1.3.0';
export const TIME_EXPAND_LIMIT = 2000;
export const NCSS_WARN_TIMESTEPS = 1500;

export const PALETTE_LABELS = {
  default: 'Default',
  'seq-Blues': 'Sequential Blues',
  'seq-BuGn': 'Sequential Blue-Green',
  'seq-GnBu': 'Sequential Green-Blue',
  'seq-Greens': 'Sequential Greens',
  'seq-YlOrRd': 'Sequential Yellow-Orange-Red',
  'seq-OrRd': 'Sequential Orange-Red',
  'seq-Reds': 'Sequential Reds',
  'seq-Heat': 'Sequential Heat',
  'seq-viridis': 'Viridis (sequential)',
  'psu-viridis': 'PSU Viridis',
  'div-Spectral': 'Diverging Spectral',
  'div-RdBu': 'Diverging Red \u2192 Blue',
  'div-RdBu-inv': 'Diverging Blue \u2192 Red'
};

export const FALLBACK_PALETTES = Object.keys(PALETTE_LABELS);

export const DEFAULT_VARIABLE_LABELS = {
  pr: 'Total Precipitation',
  tas: 'Mean Temperature',
  tasmax: 'Daily Maximum Temperature',
  tasmin: 'Daily Minimum Temperature',
  tmax: 'Mean Daily Maximum Temperature',
  tmin: 'Mean Daily Minimum Temperature'
};

export const CRS_OPTIONS = [
  { code: 'CRS:84', label: 'CRS:84' },
  { code: 'EPSG:4326', label: 'EPSG:4326' },
  { code: 'EPSG:3857', label: 'EPSG:3857' },
  { code: 'EPSG:3978', label: 'EPSG:3978' },
  { code: 'EPSG:3005', label: 'EPSG:3005' }
];

export const DEFAULT_CANADA_BBOX_4326 = { west: -141, south: 41, east: -52, north: 84.5 };

export function normalizePortalId(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildDefaultPortalConfig(portalId) {
  const id = normalizePortalId(portalId);
  const known = KNOWN_PORTALS.find((portal) => portal.id === id);

  return {
    id,
    title: known?.title || id,
    mount: known?.mount || id,
    threddsRoot: '/thredds/',
    defaultCrs: known?.defaultCrs || 'EPSG:3857',
    groups: [
      {
        id: 'default',
        label: 'Datasets',
        baseCatalogPath: `data/${known?.mount || id}`,
        files: { excludeAnySubstr: ['/derived/', '/Derived/', 'derived/'] },
        variable: { fromFilename: { type: 'prefix', toLowerCase: true } }
      }
    ]
  };
}

export function readPortalId() {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get(PORTAL_PARAM_KEY);
  if (raw) return raw.trim().toLowerCase();
  const match = url.pathname.match(/\/portal\/([^/]+)\/?/i);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return null;
}