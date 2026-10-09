import { formatDisplayUnits } from '../core/units.js';

export function parseCellValue(xml) {
  // ncWMS returns a scalar <value> in FeatureInfoResponse, or no Feature for
  // an empty cell. Read only that numeric field; never render server markup.
  if (!/<FeatureInfoResponse\b/.test(xml) || /<(?:ServiceException|ExceptionReport)\b/.test(xml)) {
    throw new Error('Unexpected cell-value response.');
  }
  const raw = /<value\b[^>]*>\s*([^<]*)\s*<\/value>/.exec(xml)?.[1]?.trim();
  if (!raw || /^(?:none|null|nan)$/i.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error('Invalid cell value.');
  return value;
}

export function formatCellValue(value, label, units) {
  const name = label ? `${label} cell` : 'Cell';
  if (value === null) return `${name}: No data`;
  const magnitude = Math.abs(value);
  const number = magnitude > 0 && (magnitude < 0.001 || magnitude >= 1e7)
    ? String(Number(value.toPrecision(6)))
    : value.toLocaleString('en-US', { maximumSignificantDigits: 6 });
  const displayUnits = formatDisplayUnits(units);
  return `${name}: ${number}${displayUnits ? ` ${displayUnits}` : ''}`;
}

export function cellValueRequest(source, coordinate, view, label, units) {
  const resolution = view.getResolution();
  if (!Number.isFinite(resolution) || resolution <= 0) return null;
  const url = source.getFeatureInfoUrl(coordinate, resolution, view.getProjection(), {
    INFO_FORMAT: 'text/xml', FEATURE_COUNT: 1,
  });
  return url ? { url, label, units } : null;
}
