import assert from 'node:assert/strict';
import { test } from 'vitest';

globalThis.window = { PDP_RUNTIME_CONFIG: {}, location: { href: 'http://localhost/pdp-next/' } };

const {
  buildWmsRequestParams, formatRenderingValue, getEffectiveRendering, logMinForScaleSwitch,
  validateRendering,
} = await import('../viewer/js/map/controller.js');
const { buildViewerUrl, readViewerUrlState } = await import('../viewer/js/core/config.js');

const base = { min: 0.02, max: 100, scaleType: 'log', palette: 'seq-Blues', numColorBands: 100,
  belowMinColor: 'transparent', aboveMaxColor: '0x202020', style: 'default-scalar/seq-Blues' };

function commonParams(requests) {
  const keys = ['PALETTE', 'NUMCOLORBANDS', 'COLORSCALERANGE', 'LOGSCALE', 'BELOWMINCOLOR', 'ABOVEMAXCOLOR'];
  return keys.map((key) => [key, requests.map[key], requests.legend[key]]);
}

test('map and legend share rendering params for log and linear scales', () => {
  for (const scaleType of ['log', 'linear']) {
    const requests = buildWmsRequestParams({ ...base, scaleType }, true, 'pr', 'EPSG:4326');
    for (const [key, mapValue, legendValue] of commonParams(requests)) {
      assert.equal(mapValue, legendValue, key);
    }
    assert.equal(requests.map.LOGSCALE, scaleType === 'log' ? 'true' : undefined);
    assert.equal(requests.legend.LOGSCALE, scaleType === 'log' ? 'true' : undefined);
    const contour = buildWmsRequestParams({ ...base, scaleType }, false, 'pr', 'EPSG:4326');
    assert.equal(contour.map.LOGSCALE, contour.legend.LOGSCALE);
    assert.equal(contour.map.BELOWMINCOLOR, 'transparent');
    assert.equal(contour.legend.BELOWMINCOLOR, 'transparent');
  }
});

test('entered precip minimum reaches both requests unchanged', () => {
  const config = getEffectiveRendering({ min: 0, max: 100, scaleType: 'log', suggestedMin: 0.01 },
    { min: 0.1, palette: 'seq-Blues' });
  const requests = buildWmsRequestParams(config, true, 'pr', 'EPSG:4326');
  assert.equal(requests.map.COLORSCALERANGE, '0.1,100');
  assert.equal(requests.legend.COLORSCALERANGE, '0.1,100');
});

test('dataset minimum, fallback and portal suggestion have expected precedence', () => {
  assert.equal(getEffectiveRendering({ min: 0.04, max: 20, scaleType: 'log' }).min, 0.04);
  assert.equal(getEffectiveRendering({ min: 0, max: 20, scaleType: 'log', suggestedMin: 0.01 }).min, 0.01);
  assert.equal(getEffectiveRendering({ min: 0.2, max: 20, scaleType: 'log', suggestedMin: 1 }).min, 1);
  assert.equal(getEffectiveRendering({ min: 0, max: 20, scaleType: 'log', suggestedMin: 0.01 }, { min: -1, scaleType: 'linear' }).min, -1);
});

test('linear to log switch replaces nonpositive min and validation preserves invalid entry', () => {
  assert.equal(logMinForScaleSwitch('0', { suggestedMin: 0.01 }), 0.01);
  assert.equal(logMinForScaleSwitch('-2', { suggestedMin: 0.01 }), 0.01);
  assert.equal(logMinForScaleSwitch('0.1', { suggestedMin: 0.01 }), null);
  assert.equal(logMinForScaleSwitch('-2', { min: 0.04 }), 0.04);
  assert.equal(logMinForScaleSwitch('-2', { min: -5 }), 0.01);
  assert.equal(validateRendering({ scaleType: 'log', min: 0, max: 10 }),
    'Logarithmic scale requires a minimum greater than 0.');
  assert.equal(validateRendering({ scaleType: 'linear', min: 10, max: 10 }),
    'Minimum must be less than maximum.');
  assert.equal(validateRendering({ scaleType: 'linear', min: -10, max: 0 }), null);
  assert.equal(validateRendering({ scaleType: 'linear', min: -10, max: null }),
    'Minimum and maximum must be finite numbers.');
});

test('scale type survives URL round trip and legacy URLs use metadata default', () => {
  const href = buildViewerUrl('vicgl', { scaleType: 'linear', min: -1, max: 4 });
  assert.equal(readViewerUrlState(href).scaleType, 'linear');
  assert.equal(readViewerUrlState('http://localhost/pdp-next/?portal=vicgl').scaleType, null);
  assert.equal(getEffectiveRendering({ scaleType: 'log' }, { scaleType: null }).scaleType, 'log');
  const tinyHref = buildViewerUrl('bccaqv2_u5', { scaleType: 'log', min: 1e-9, max: 0.123456789 });
  assert.equal(readViewerUrlState(tinyHref).min, 1e-9);
  assert.equal(readViewerUrlState(tinyHref).max, 0.123456789);
});

test('portal decimal precision formats defaults but preserves a more precise user value', () => {
  assert.equal(formatRenderingValue(12.35, 2), '12.35');
  assert.equal(formatRenderingValue(12.345, 2), '12.345');
  assert.equal(formatRenderingValue(0.001, 2), '0.001');
});
