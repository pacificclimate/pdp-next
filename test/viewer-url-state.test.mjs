import assert from 'node:assert/strict';
import { test } from 'vitest';

globalThis.window = {
  PDP_RUNTIME_CONFIG: {},
  location: { href: 'http://localhost/pdp-next/' },
};

const { buildViewerUrl, readViewerUrlState } = await import('../viewer/js/core/config.js');
const { reprojectViewState } = await import('../viewer/js/map/controller.js');
const { ol } = await import('../viewer/js/core/openlayers.js');

test('preserves a projected viewport extent in the selected CRS', () => {
  const href = buildViewerUrl('mbcn', {
    dataset: 'data/mbcn/pr_day.nc',
    variable: 'pr',
    view: [-6000000, -5000000, 6000000, 5000000],
    crs: 'EPSG:3978',
  }, 'http://localhost/pdp-next/?portal=mbcn');

  const state = readViewerUrlState(href);
  assert.deepEqual(state.view, [-6000000, -5000000, 6000000, 5000000]);
  assert.equal(state.crs, 'EPSG:3978');
  assert.equal(new URL(href).searchParams.has('viewCrs'), false);
});

test('reads the viewport in the selected CRS', () => {
  const state = readViewerUrlState(
    'http://localhost/pdp-next/?view=-179.5,14.3,176.4,86.7&crs=EPSG:3978',
  );

  assert.deepEqual(state.view, [-179.5, 14.3, 176.4, 86.7]);
  assert.equal(state.crs, 'EPSG:3978');
});

test('preserves geographic center and ground resolution when changing CRS', () => {
  const sourceCrs = 'EPSG:3857';
  const targetCrs = 'EPSG:4326';
  const sourceCenter = ol.proj.transform([-123, 54], 'EPSG:4326', sourceCrs);
  const sourceResolution = 5000;
  const projected = reprojectViewState(
    ol,
    sourceCrs,
    targetCrs,
    sourceCenter,
    sourceResolution,
  );

  assert.ok(projected);
  assert.ok(Math.abs(projected.center[0] + 123) < 1e-9);
  assert.ok(Math.abs(projected.center[1] - 54) < 1e-9);

  const sourceMetersPerPixel = ol.proj.getPointResolution(
    sourceCrs,
    sourceResolution,
    sourceCenter,
    'm',
  );
  const targetMetersPerPixel = ol.proj.getPointResolution(
    targetCrs,
    projected.resolution,
    projected.center,
    'm',
  );
  assert.ok(Math.abs(sourceMetersPerPixel - targetMetersPerPixel) / sourceMetersPerPixel < 1e-5);
});
