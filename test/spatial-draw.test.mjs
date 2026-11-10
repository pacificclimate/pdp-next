import assert from 'node:assert/strict';
import { test } from 'vitest';
import proj4 from 'proj4';
import Observable from 'ol/Observable.js';
import View from 'ol/View.js';
import { ol } from '../viewer/js/core/openlayers.js';
import { createSubsetDrawController } from '../viewer/js/subsetting/draw.js';
import { formatCoordinatePair } from '../viewer/js/map/coordinates.js';
import { bboxCorners, bboxDisplayGeometry, parseBboxInput, reprojectSubsetFeatures } from '../viewer/js/subsetting/bbox.js';

proj4.defs('EPSG:3005', '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs');
ol.proj.proj4.register(proj4);

class Element extends EventTarget {
  value = '';
  hidden = true;
  checked = false;
  textContent = '';
  attributes = {};
  setAttribute(key, value) { this.attributes[key] = value; }
}
class Overlay {
  constructor(options) { this.options = options; }
  getElement() { return this.options.element; }
  setPosition(position) { this.position = position; }
}
function context(crs = 'EPSG:4326', editorCrs = crs) {
  globalThis.document = { createElement: () => new Element() };
  const ui = Object.fromEntries(['bboxEditor', 'bboxCrs', 'bboxMinX', 'bboxMinY', 'bboxMaxX', 'bboxMaxY',
    'bboxError', 'bboxApply', 'bboxShowCoordinates', 'bboxMinXLabel', 'bboxMinYLabel',
    'bboxMaxXField', 'bboxMaxYField', 'bboxShowLabel', 'bboxHint',
    'bboxEditCrs', 'bboxSummary', 'bboxMaxXLabel', 'bboxMaxYLabel'].map((id) => [id, new Element()]));
  const map = new Observable();
  const viewport = new Element();
  viewport.style = {};
  const interactions = [];
  const overlays = [];
  let currentCrs = crs;
  let view = new View({ projection: crs });
  Object.assign(map, {
    addOverlay: (overlay) => overlays.push(overlay),
    addInteraction(interaction) { interactions.push(interaction); interaction.getMap = () => map; },
    removeInteraction(interaction) { const i = interactions.indexOf(interaction); if (i >= 0) interactions.splice(i, 1); },
    getView: () => view,
    getViewport: () => viewport,
    getPixelFromCoordinate: (coordinate) => [coordinate[0] / 1000, -coordinate[1] / 1000],
  });
  const source = new ol.source.Vector();
  const layer = new ol.layer.Vector({ source });
  const controller = createSubsetDrawController({ map, olRef: { ...ol, Overlay },
    subsetDrawSource: source, subsetDrawLayer: layer, setStatus() {}, getCurrentCrs: () => currentCrs, ui });
  controller.setSubsetDrawMode('draw_bbox');
  const draw = interactions[0];
  const edit = interactions[1];
  const project = (coordinate) => ol.proj.transform(coordinate, 'EPSG:4326', currentCrs);
  function drawBox(a = [-135, 50], b = [-115, 60]) {
    draw.startDrawing_(project(a));
    draw.modifyDrawing_(project(b));
    if (editorCrs !== crs) editIn(ui, editorCrs);
    return draw.sketchFeature_;
  }
  function changeProjection(nextCrs) {
    reprojectSubsetFeatures(ol, source, currentCrs, nextCrs);
    currentCrs = nextCrs;
    view = new View({ projection: nextCrs });
    map.dispatchEvent('change:view');
  }
  return { ui, map, viewport, overlays, interactions, controller, draw, edit, source, layer, project, drawBox, changeProjection };
}
const fields = (ui) => [ui.bboxMinX, ui.bboxMinY, ui.bboxMaxX, ui.bboxMaxY];
const values = (ui) => fields(ui).map((field) => Number(field.value));
function editIn(ui, crs) { ui.bboxEditCrs.value = crs; ui.bboxEditCrs.dispatchEvent(new Event('change')); }
function enter(ui, extent) { fields(ui).forEach((field, index) => { field.value = String(extent[index]); }); }
function approx(actual, expected) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-8));
}

test('real OpenLayers live drawing synchronizes exact bbox fields and completes without a jump', () => {
  const c = context('EPSG:3005', 'EPSG:4326');
  const feature = c.drawBox([-135.123456789, 50.123456789], [-115.987654321, 60.987654321]);
  const extent = [-135.12346, 50.12346, -115.98765, 60.98765];
  assert.deepEqual(values(c.ui), extent);
  assert.equal(c.ui.bboxEditor.hidden, false);
  assert.equal(c.ui.bboxCrs.textContent, 'EPSG:4326');
  const live = feature.getGeometry().getCoordinates();
  const original = feature.get('selectionGeometry').getCoordinates();
  c.draw.finishDrawing();
  assert.equal(c.source.getFeatures()[0], feature);
  assert.deepEqual(feature.getGeometry().getCoordinates(), live);
  assert.deepEqual(feature.get('selectionGeometry').getCoordinates(), original);
  assert.deepEqual(Object.values(c.controller.getDrawnBbox4326()), extent);
});

test('Apply and Enter change map geometry exactly; typing changes only the draft', () => {
  const c = context('EPSG:3005', 'EPSG:4326');
  const feature = c.drawBox();
  c.draw.finishDrawing();
  const before = feature.getGeometry().getCoordinates();
  const extent = [-130.12346, 48.12346, -120.98765, 58.98765];
  enter(c.ui, extent);
  assert.deepEqual(feature.getGeometry().getCoordinates(), before);
  c.ui.bboxApply.dispatchEvent(new Event('click'));
  assert.deepEqual(feature.get('selectionGeometry').getExtent(), extent);
  assert.deepEqual(feature.getGeometry().getCoordinates(), bboxDisplayGeometry(ol, extent, 'EPSG:4326', 'EPSG:3005').getCoordinates());
  const next = [-129, 49, -119, 59];
  enter(c.ui, next);
  const event = new Event('keydown', { cancelable: true });
  event.key = 'Enter';
  c.ui.bboxMaxY.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(feature.get('selectionGeometry').getExtent(), next);
});

test('projected corner edits update the exact lon/lat bbox and summary without adding area', () => {
  const c = context('EPSG:3005');
  const feature = c.drawBox();
  c.draw.finishDrawing();
  assert.equal(c.ui.bboxEditCrs.value, 'EPSG:3005');
  assert.equal(c.ui.bboxMinXLabel.textContent, 'Southwest X (m)');
  assert.deepEqual(values(c.ui), [...c.project([-135, 50]), ...c.project([-115, 60])].map(Math.round));
  const before = feature.get('selectionGeometry');
  const summary = c.ui.bboxSummary.textContent;
  const extent = [-120, 50, -119.9, 60];
  const projected = [...c.project(extent.slice(0, 2)), ...c.project(extent.slice(2))].map(Math.round);
  assert.ok(projected[0] > projected[2]); // Corner coordinates are not projected Min/Max.
  enter(c.ui, projected);
  assert.equal(c.ui.bboxSummary.textContent, summary);
  assert.equal(feature.get('selectionGeometry'), before);
  const event = new Event('keydown', { cancelable: true });
  event.key = 'Enter';
  c.ui.bboxMaxY.dispatchEvent(event);
  assert.equal(c.ui.bboxError.textContent, '');
  assert.equal(feature.get('selectionCrs'), 'EPSG:4326');
  const converted = [projected.slice(0, 2), projected.slice(2)].flatMap((p) =>
    ol.proj.transform(p, 'EPSG:3005', 'EPSG:4326')).map((v) => Number(v.toFixed(5)));
  assert.deepEqual(feature.get('selectionGeometry').getExtent(), converted);
  assert.deepEqual(Object.values(c.controller.getDrawnBbox4326()), converted);
  assert.equal(c.ui.bboxSummary.textContent,
    `Lon: ${converted[0]} to ${converted[2]} · Lat: ${converted[1]} to ${converted[3]}`);
  const applied = feature.get('selectionGeometry');
  editIn(c.ui, 'EPSG:4326');
  assert.deepEqual(values(c.ui), converted);
  assert.equal(feature.get('selectionGeometry'), applied);
  c.ui.bboxShowCoordinates.checked = true;
  c.ui.bboxShowCoordinates.dispatchEvent(new Event('change'));
  assert.equal(c.overlays[0].getElement().textContent,
    `EPSG:3005 · ${formatCoordinatePair(c.overlays[0].position, 'EPSG:3005')}`);
});

test('repeated Apply preserves exact projected inputs and canonical bbox/point coordinates', () => {
  for (const type of ['bbox', 'point']) {
    const c = context('EPSG:3005');
    c.controller.restoreSelection({ type, crs: 'EPSG:4326',
      coordinates: type === 'bbox' ? [-130.123456789, 49.123456789, -120.987654321, 59.987654321] : [-123.123456789, 49.123456789] });
    const feature = c.source.getFeatures()[0];
    const rounded = type === 'bbox' ? [-130.12346, 49.12346, -120.98765, 59.98765]
      : [-123.12346, 49.12346, -123.12346, 49.12346];
    assert.deepEqual(feature.get('selectionGeometry').getExtent(), rounded);
    assert.deepEqual(Object.values(c.controller.getDrawnBbox4326()), rounded);
    const unchanged = feature.get('selectionGeometry');
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.equal(feature.get('selectionGeometry'), unchanged);
    const input = type === 'bbox'
      ? [700000, 500000, 1000001, 900001]
      : [700000, 500000];
    enter(c.ui, input);
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.equal(c.ui.bboxError.textContent, '');
    assert.deepEqual(values(c.ui).slice(0, input.length), input);
    const applied = feature.get('selectionGeometry');
    const extent = c.controller.getDrawnBbox4326();
    for (let click = 0; click < 10; click += 1) {
      c.ui.bboxApply.dispatchEvent(new Event('click'));
      assert.equal(feature.get('selectionGeometry'), applied);
      assert.deepEqual(c.controller.getDrawnBbox4326(), extent);
      assert.deepEqual(values(c.ui).slice(0, input.length), input);
    }
    for (const excessive of ['700000.1', '7.000001e5']) {
      c.ui.bboxMinX.value = excessive;
      c.ui.bboxApply.dispatchEvent(new Event('click'));
      assert.equal(c.ui.bboxError.textContent, 'Use whole metres.');
      assert.equal(c.ui.bboxMinX.value, excessive);
      assert.equal(feature.get('selectionGeometry'), applied);
    }
    editIn(c.ui, 'EPSG:4326');
    c.ui.bboxMinX.value = '-130.123456';
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.equal(c.ui.bboxError.textContent, 'Use at most 5 decimal places.');
    assert.equal(feature.get('selectionGeometry'), applied);
  }
});

test('invalid inputs show inline validation and preserve the bbox and entered text', () => {
  const c = context();
  const feature = c.drawBox();
  c.draw.finishDrawing();
  const before = feature.getGeometry().getCoordinates();
  for (const input of [['', 0, 1, 2], ['word', 0, 1, 2], ['Infinity', 0, 1, 2], [1, 0, 1, 2], [2, 0, 1, 2], [0, 2, 1, 2], [0, 3, 1, 2]]) {
    enter(c.ui, input);
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.ok(c.ui.bboxError.textContent);
    assert.equal(c.ui.bboxMinX.attributes['aria-invalid'], 'true');
    assert.equal(c.ui.bboxMinX.value, String(input[0]));
    assert.deepEqual(feature.getGeometry().getCoordinates(), before);
  }
  assert.deepEqual(parseBboxInput(['-1e2', '0', '0.125', '2e1']).extent, [-100, 0, 0.125, 20]);
});

test('bbox edits reject out-of-range lon/lat in a projected map without changing geometry', () => {
  const c = context('EPSG:3005', 'EPSG:4326');
  const feature = c.drawBox();
  c.draw.finishDrawing();
  const before = feature.getGeometry().getCoordinates();
  for (const extent of [[-3000, 50, -115, 60], [-135, 50, 181, 60], [-135, -91, -115, 60], [-135, 50, -115, 91]]) {
    enter(c.ui, extent);
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.match(c.ui.bboxError.textContent, /must be between/);
    assert.deepEqual(values(c.ui), extent);
    assert.deepEqual(feature.getGeometry().getCoordinates(), before);
  }
});

test('optional labels track live corners, numeric Apply, projection changes and clearing', () => {
  const c = context();
  c.drawBox();
  assert.ok(c.overlays.every((overlay) => overlay.position === undefined));
  c.ui.bboxShowCoordinates.checked = true;
  c.ui.bboxShowCoordinates.dispatchEvent(new Event('change'));
  assert.deepEqual(c.overlays.map((overlay) => overlay.getElement().textContent), [
    'EPSG:4326 · Lon: -135.00000 · Lat: 50.00000', 'EPSG:4326 · Lon: -115.00000 · Lat: 50.00000', 'EPSG:4326 · Lon: -115.00000 · Lat: 60.00000', 'EPSG:4326 · Lon: -135.00000 · Lat: 60.00000']);
  c.draw.modifyDrawing_(c.project([-120, 59]));
  assert.equal(c.overlays[2].getElement().textContent, 'EPSG:4326 · Lon: -120.00000 · Lat: 59.00000');
  c.draw.finishDrawing();
  enter(c.ui, [-130, 49, -119, 58]);
  c.ui.bboxApply.dispatchEvent(new Event('click'));
  assert.deepEqual(c.overlays.map((overlay) => overlay.position), bboxCorners([-130, 49, -119, 58]));
  c.changeProjection('EPSG:3005');
  assert.deepEqual(c.overlays[0].position, c.project([-130, 49]));
  assert.equal(c.overlays[0].getElement().textContent, `EPSG:3005 · ${formatCoordinatePair(c.project([-130, 49]), 'EPSG:3005')}`);
  c.controller.clearSubsetDrawing();
  assert.equal(c.ui.bboxEditor.hidden, true);
  assert.ok(c.overlays.every((overlay) => overlay.position === undefined));
});

test('geographic bbox in EPSG:3005 has tilted meridians and curved parallels', () => {
  const ring = bboxDisplayGeometry(ol, [-135, 50, -115, 60], 'EPSG:4326', 'EPSG:3005').getCoordinates()[0];
  assert.equal(ring.length, 65);
  assert.notEqual(ring[0][1], ring[16][1]);
  assert.notEqual(ring[0][0], ring[48][0]);
  const midpoint = ol.proj.transform([-125, 50], 'EPSG:4326', 'EPSG:3005');
  assert.deepEqual(ring[8], midpoint);
  assert.ok(Math.abs(midpoint[1] - (ring[0][1] + ring[16][1]) / 2) > 50000);
});

test('projection round trips preserve the canonical bbox and exact fields', () => {
  const c = context();
  const feature = c.drawBox();
  c.draw.finishDrawing();
  const extent = [-130.12346, 48.12346, -120.98765, 58.98765];
  enter(c.ui, extent);
  c.ui.bboxApply.dispatchEvent(new Event('click'));
  const original = feature.get('selectionGeometry');
  for (const crs of ['EPSG:3005', 'EPSG:3857', 'EPSG:4326', 'EPSG:3005']) {
    c.changeProjection(crs);
    assert.equal(feature.get('selectionGeometry'), original);
    assert.equal(feature.get('selectionCrs'), 'EPSG:4326');
    assert.deepEqual(values(c.ui), extent);
    assert.deepEqual(feature.getGeometry().getCoordinates(), bboxDisplayGeometry(ol, extent, 'EPSG:4326', crs).getCoordinates());
  }
});

test('corner dragging and movement update fields in the defining CRS', () => {
  const c = context('EPSG:3005', 'EPSG:4326');
  const feature = c.drawBox();
  c.draw.finishDrawing();
  const event = (lonlat) => {
    const coordinate = c.project(lonlat);
    return { coordinate, pixel: c.map.getPixelFromCoordinate(coordinate), originalEvent: { button: 0 } };
  };
  for (const [index, corner] of bboxCorners([-135, 50, -115, 60]).entries()) {
    c.map.dispatchEvent({ ...event(corner), type: 'pointermove' });
    assert.equal(c.viewport.style.cursor, index % 2 === 0 ? 'nesw-resize' : 'nwse-resize');
  }
  c.map.dispatchEvent({ ...event([-127, 54]), type: 'pointermove' });
  assert.equal(c.viewport.style.cursor, 'grab');
  c.map.dispatchEvent({ ...event([-145, 40]), type: 'pointermove' });
  assert.equal(c.viewport.style.cursor, '');
  assert.equal(c.edit.handleDownEvent(event([-115, 60])), true);
  assert.equal(c.viewport.style.cursor, 'nesw-resize');
  c.edit.handleDragEvent(event([-120, 58]));
  assert.equal(c.viewport.style.cursor, 'nesw-resize');
  c.edit.handleUpEvent(event([-120, 58]));
  assert.equal(c.viewport.style.cursor, 'nesw-resize');
  approx(values(c.ui), [-135, 50, -120, 58]);
  assert.equal(c.edit.handleDownEvent(event([-127, 54])), true);
  assert.equal(c.viewport.style.cursor, 'grabbing');
  c.edit.handleDragEvent(event([-126, 55]));
  c.edit.handleUpEvent(event([-126, 55]));
  assert.equal(c.viewport.style.cursor, 'grab');
  approx(values(c.ui), [-134, 51, -119, 59]);
  c.controller.setSubsetDrawMode('whole');
  assert.equal(c.viewport.style.cursor, '');
  assert.deepEqual(feature.getGeometry().getCoordinates(), bboxDisplayGeometry(ol, feature.get('selectionGeometry').getExtent(), 'EPSG:4326', 'EPSG:3005').getCoordinates());
});

test('mode switches and draw abort hide bbox UI and leave point selection intact', () => {
  const c = context();
  c.drawBox();
  c.draw.abortDrawing();
  assert.equal(c.ui.bboxEditor.hidden, true);
  c.drawBox();
  c.draw.finishDrawing();
  c.controller.setSubsetDrawMode('draw_point');
  assert.equal(c.ui.bboxEditor.hidden, true);
  c.controller.setSubsetDrawMode('draw_bbox');
  assert.equal(c.ui.bboxEditor.hidden, false);
});

test('label toggles and projection changes preserve unapplied numeric input', () => {
  const c = context();
  c.drawBox();
  c.draw.finishDrawing();
  c.ui.bboxMinX.value = '-130.123456789';
  c.ui.bboxShowCoordinates.checked = true;
  c.ui.bboxShowCoordinates.dispatchEvent(new Event('change'));
  assert.equal(c.ui.bboxMinX.value, '-130.123456789');
  c.changeProjection('EPSG:3005');
  assert.equal(c.ui.bboxMinX.value, '-130.123456789');
  assert.equal(c.overlays[0].getElement().textContent, `EPSG:3005 · ${formatCoordinatePair(c.project([-135, 50]), 'EPSG:3005')}`);
});


test('point drawing and reprojection preserve the existing point subset behavior', () => {
  const c = context('EPSG:3005');
  c.controller.setSubsetDrawMode('draw_point');
  const draw = c.interactions[0];
  draw.startDrawing_(c.project([-123, 49]));
  draw.finishDrawing();
  const feature = c.source.getFeatures()[0];
  assert.equal(feature.getGeometry().getType(), 'Point');
  assert.equal(feature.get('selectionCrs'), 'EPSG:3005');
  approx(Object.values(c.controller.getDrawnBbox4326()), [-123, 49, -123, 49]);
  c.changeProjection('EPSG:3857');
  assert.equal(feature.getGeometry().getType(), 'Point');
  approx(Object.values(c.controller.getDrawnBbox4326()), [-123, 49, -123, 49]);
  assert.equal(c.ui.bboxEditor.hidden, false);
});

test('point editor applies exact X/Y on Apply and Enter, with inline numeric validation', () => {
  const c = context('EPSG:3005');
  c.controller.setSubsetDrawMode('draw_point');
  const draw = c.interactions[0];
  draw.startDrawing_(c.project([-123, 49]));
  draw.finishDrawing();
  const feature = c.source.getFeatures()[0];
  const before = feature.get('selectionGeometry').getCoordinates();
  assert.deepEqual(values(c.ui).slice(0, 2), before);
  assert.equal(c.ui.bboxMinXLabel.textContent, 'X (m)');
  assert.equal(c.ui.bboxMinYLabel.textContent, 'Y (m)');
  assert.equal(c.ui.bboxMaxXField.hidden, true);
  assert.equal(c.ui.bboxMaxYField.hidden, true);
  assert.equal(c.ui.bboxCrs.textContent, 'EPSG:4326');
  const next = [1317626, 19638];
  enter(c.ui, next);
  assert.deepEqual(feature.getGeometry().getCoordinates(), before);
  c.ui.bboxApply.dispatchEvent(new Event('click'));
  assert.deepEqual(feature.getGeometry().getCoordinates(), next);
  assert.deepEqual(feature.get('selectionGeometry').getCoordinates(), next);
  assert.deepEqual(values(c.ui).slice(0, 2), next);
  for (const invalid of [['', 1], [1, 'bad'], ['Infinity', 1]]) {
    enter(c.ui, invalid);
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    assert.equal(c.ui.bboxError.textContent, 'Enter two finite numbers.');
    assert.deepEqual(feature.getGeometry().getCoordinates(), next);
  }
  enter(c.ui, [124, -456]);
  const event = new Event('keydown', { cancelable: true });
  event.key = 'Enter';
  c.ui.bboxMinY.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(c.ui.bboxError.textContent, '');
  assert.deepEqual(feature.getGeometry().getCoordinates(), [124, -456]);
});

test('point dragging, label display and projection changes follow the canonical point', () => {
  const c = context('EPSG:3005');
  c.controller.restoreSelection({ type: 'point', crs: 'EPSG:4326', coordinates: [-123, 49] });
  editIn(c.ui, 'EPSG:4326');
  const feature = c.source.getFeatures()[0];
  const edit = c.interactions[1];
  const event = (lonlat) => {
    const coordinate = c.project(lonlat);
    return { coordinate, pixel: c.map.getPixelFromCoordinate(coordinate), originalEvent: { button: 0 } };
  };
  c.viewport.style.cursor = 'crosshair';
  c.map.dispatchEvent({ ...event([-123, 49]), type: 'pointermove' });
  assert.equal(c.viewport.style.cursor, 'grab');
  c.map.dispatchEvent({ ...event([-124, 49]), type: 'pointermove' });
  assert.equal(c.viewport.style.cursor, 'crosshair');
  assert.equal(edit.handleDownEvent(event([-124, 49])), false);
  assert.equal(edit.handleDownEvent(event([-123, 49])), true);
  assert.equal(c.viewport.style.cursor, 'grabbing');
  edit.handleDragEvent(event([-122, 50]));
  assert.equal(c.viewport.style.cursor, 'grabbing');
  edit.handleUpEvent(event([-122, 50]));
  assert.equal(c.viewport.style.cursor, 'grab');
  c.viewport.dispatchEvent(new Event('pointerleave'));
  assert.equal(c.viewport.style.cursor, 'crosshair');
  approx(values(c.ui).slice(0, 2), [-122, 50]);
  c.ui.bboxShowCoordinates.checked = true;
  c.ui.bboxShowCoordinates.dispatchEvent(new Event('change'));
  assert.equal(c.overlays[0].getElement().textContent, `EPSG:3005 · ${formatCoordinatePair(c.project([-122, 50]), 'EPSG:3005')}`);
  assert.deepEqual(c.overlays[0].position, feature.getGeometry().getCoordinates());
  assert.ok(c.overlays.slice(1).every((overlay) => overlay.position === undefined));
  const original = feature.get('selectionGeometry');
  c.changeProjection('EPSG:3857');
  assert.equal(feature.get('selectionGeometry'), original);
  assert.deepEqual(feature.getGeometry().getCoordinates(), original.clone().transform('EPSG:4326', 'EPSG:3857').getCoordinates());
  assert.deepEqual(values(c.ui).slice(0, 2), original.getCoordinates());
  assert.deepEqual(c.overlays[0].position, feature.getGeometry().getCoordinates());
  c.controller.clearSubsetDrawing();
  assert.equal(c.ui.bboxEditor.hidden, true);
  assert.equal(c.overlays[0].position, undefined);
});

test('shared selection round trips restore exact geometry, editor and mode in another projection', async () => {
  const { getDrawnSelection } = await import('../viewer/js/subsetting/selection.js');
  globalThis.window = { PDP_RUNTIME_CONFIG: {}, location: { href: 'http://localhost/pdp-next/' } };
  const { buildViewerUrl, readViewerUrlState } = await import('../viewer/js/core/config.js');
  for (const selection of [
    { type: 'bbox', crs: 'EPSG:4326', coordinates: [-130.12346, 48.12346, -120.98765, 58.98765] },
    { type: 'point', crs: 'EPSG:3005', coordinates: [1317626, 19638] },
  ]) {
    const c = context('EPSG:3857');
    const href = buildViewerUrl('mbcn', { crs: 'EPSG:3857', selection });
    assert.equal(c.controller.restoreSelection(readViewerUrlState(href).selection), true);
    const mode = selection.type === 'point' ? 'draw_point' : 'draw_bbox';
    assert.deepEqual(getDrawnSelection(c.source, mode), selection);
    assert.equal(c.ui.bboxEditor.hidden, false);
    assert.equal(c.ui.bboxEditCrs.value, 'EPSG:3857');
    editIn(c.ui, selection.crs);
    assert.equal(c.ui.bboxCrs.textContent, 'EPSG:4326');
    assert.deepEqual(values(c.ui).slice(0, selection.coordinates.length),
      selection.coordinates);
    const geometry = c.source.getFeatures()[0].getGeometry();
    assert.deepEqual(geometry.getCoordinates(), selection.type === 'bbox'
      ? bboxDisplayGeometry(ol, selection.coordinates, selection.crs, 'EPSG:3857').getCoordinates()
      : ol.proj.transform(selection.coordinates, selection.crs, 'EPSG:3857'));
    assert.equal(getDrawnSelection(c.source, 'whole'), null);
    c.changeProjection('EPSG:3005');
    assert.deepEqual(getDrawnSelection(c.source, mode), selection);
    enter(c.ui, selection.type === 'bbox' ? [-130, 49, -120, 59] : [123456, 987655]);
    c.ui.bboxApply.dispatchEvent(new Event('click'));
    const updated = getDrawnSelection(c.source, mode);
    assert.deepEqual(readViewerUrlState(buildViewerUrl('mbcn', { selection: updated })).selection, updated);
    c.controller.clearSubsetDrawing();
    assert.equal(getDrawnSelection(c.source, mode), null);
  }
});

test('unsupported selection CRS or invalid bbox cannot replace an existing drawing', () => {
  const c = context();
  c.drawBox();
  c.draw.finishDrawing();
  const before = c.source.getFeatures()[0];
  for (const selection of [
    { type: 'point', crs: 'EPSG:999999', coordinates: [-123, 49] },
    { type: 'bbox', crs: 'EPSG:4326', coordinates: [0, 0, -1, 1] },
    { type: 'bbox', crs: 'EPSG:4326', coordinates: [0, 0, 0.000001, 0.000001] },
    { type: 'point', crs: 'EPSG:4326', coordinates: [NaN, 49] },
  ]) {
    assert.equal(c.controller.restoreSelection(selection), false);
    assert.equal(c.source.getFeatures()[0], before);
  }
});
