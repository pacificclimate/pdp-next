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

test('shares exact canonical bbox and point coordinates separately from the map CRS', () => {
  for (const selection of [
    { type: 'bbox', crs: 'EPSG:4326', coordinates: [-130.1234567890123, 48.1234567890123, -120.9876543210987, 58.9876543210987] },
    { type: 'point', crs: 'EPSG:3005', coordinates: [1317626.123456789, 19637.987654321] },
  ]) {
    const url = buildViewerUrl('mbcn', { crs: 'EPSG:3857', selection });
    const state = readViewerUrlState(url);
    assert.deepEqual(state.selection, selection);
    assert.equal(state.crs, 'EPSG:3857');
    assert.equal(new URL(url).searchParams.has('selectionGeometry'), false);
    const baseline = buildViewerUrl('mbcn', { crs: 'EPSG:3857' });
    assert.ok(url.length - baseline.length < 200);
  }
});

test('selection URL parsing rejects malformed coordinates, types, CRS and bbox ranges', () => {
  for (const query of [
    'selection=bbox&selectionCrs=EPSG:4326&selectionCoords=0,0,1',
    'selection=bbox&selectionCrs=EPSG:4326&selectionCoords=0,0,0,1',
    'selection=bbox&selectionCrs=EPSG:4326&selectionCoords=1,1,0,0',
    'selection=point&selectionCrs=EPSG:4326&selectionCoords=,1',
    'selection=point&selectionCrs=EPSG:4326&selectionCoords=%20,1',
    'selection=point&selectionCrs=EPSG:4326&selectionCoords=Infinity,1',
    'selection=point&selectionCrs=EPSG:4326&selectionCoords=text,1',
    'selection=polygon&selectionCrs=EPSG:4326&selectionCoords=0,1',
    'selection=point&selectionCrs=garbage&selectionCoords=0,1',
    'selection=point&selectionCoords=0,1',
  ]) {
    assert.equal(readViewerUrlState(`http://localhost/pdp-next/?${query}`).selection, null, query);
  }
});

test('clearing a selection removes all selection parameters from the URL', () => {
  const href = buildViewerUrl('mbcn', { selection: { type: 'point', crs: 'EPSG:4326', coordinates: [-123, 49] } });
  const cleared = buildViewerUrl('mbcn', { selection: null }, href);
  assert.equal(readViewerUrlState(cleared).selection, null);
  for (const key of ['selection', 'selectionCrs', 'selectionCoords']) {
    assert.equal(new URL(cleared).searchParams.has(key), false);
  }
});
