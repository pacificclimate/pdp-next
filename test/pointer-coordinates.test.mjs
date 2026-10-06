import assert from 'node:assert/strict';
import { test } from 'vitest';
import Observable from 'ol/Observable.js';
import { formatCoordinatePair, installPointerCoordinates } from '../viewer/js/map/coordinates.js';

function context() {
  const map = new Observable();
  const viewport = new EventTarget();
  let crs = 'EPSG:4326';
  map.getViewport = () => viewport;
  map.getView = () => ({ getProjection: () => ({ getCode: () => crs }) });
  function changeProjection(next) { crs = next; map.dispatchEvent('change:view'); }
  return { map, viewport, changeProjection };
}
class Element { textContent = ''; hidden = true; }

test('pointer coordinate formatting uses geographic precision and rounded projected X/Y', () => {
  assert.equal(formatCoordinatePair([-123.1234567, 49.9876543], 'EPSG:4326'), 'Lon: -123.12346 · Lat: 49.98765');
  assert.equal(formatCoordinatePair([-0.00000001, 50], 'CRS:84'), 'Lon: 0.00000 · Lat: 50.00000');
  assert.equal(formatCoordinatePair([1000000.6, -23456.4], 'EPSG:3005'), 'X: 1,000,001 · Y: -23,456');
  assert.equal(formatCoordinatePair([NaN, 50], 'EPSG:4326'), '');
});

test('pointer readout follows active CRS, clears on leave and on projection change', () => {
  const c = context();
  const element = new Element();
  installPointerCoordinates(c.map, element, () => c.map.getView().getProjection().getCode());
  c.map.dispatchEvent({ type: 'pointermove', coordinate: [-123.1234567, 49.9876543] });
  assert.equal(element.textContent, 'EPSG:4326 · Lon: -123.12346 · Lat: 49.98765');
  assert.equal(element.hidden, false);
  c.viewport.dispatchEvent(new Event('pointerleave'));
  assert.equal(element.hidden, true);
  assert.equal(element.textContent, '');
  c.changeProjection('EPSG:3005');
  c.map.dispatchEvent({ type: 'pointermove', coordinate: [1000000.6, 554290.3] });
  assert.equal(element.textContent, 'EPSG:3005 · X: 1,000,001 · Y: 554,290');
  c.changeProjection('EPSG:3857');
  assert.equal(element.hidden, true);
});
