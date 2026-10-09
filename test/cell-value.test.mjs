import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import Observable from 'ol/Observable.js';
import View from 'ol/View.js';
import TileWMS from 'ol/source/TileWMS.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import { transform } from 'ol/proj.js';
import { cellValueRequest, formatCellValue, parseCellValue } from '../viewer/js/map/cell-value.js';
import { installPointerCoordinates } from '../viewer/js/map/coordinates.js';

// The deployed THREDDS GetFeatureInfo responses for a PRISM tmax cell and
// a location outside the domain, captured with INFO_FORMAT=text/xml.
const valueXml = `<FeatureInfoResponse>
    <longitude>-122.9974365234375</longitude>
    <latitude>49.0045166015625</latitude>
    <Feature>
        <layer>tmax</layer>
        <FeatureInfo>
            <id>tmax</id>
            <time>1950-01-31T00:00:00.000Z</time>
            <value>-2.2654</value>
        </FeatureInfo>
    </Feature>
</FeatureInfoResponse>`;
const emptyXml = `<FeatureInfoResponse>
    <longitude>-123.6346435546875</longitude>
    <latitude>30.6097412109375</latitude>
</FeatureInfoResponse>`;
const response = (xml = valueXml) => ({ ok: true, text: async () => xml });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.window = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (timer) => clearTimeout(timer) };
});
afterEach(() => { vi.useRealTimers(); });

function context(fetchRef = vi.fn(async () => response())) {
  const map = new Observable();
  const viewport = new EventTarget();
  map.getViewport = () => viewport;
  const element = { textContent: '', hidden: true };
  let currentRequest = { url: 'https://example.test/wms?TIME=1950-01-31', label: 'Tmax', units: 'celsius' };
  const readout = installPointerCoordinates(map, element, () => 'EPSG:4326', {
    getCellValueRequest: () => currentRequest, fetchRef,
  });
  function move(coordinate = [-123, 49], dragging = false) {
    map.dispatchEvent({ type: 'pointermove', coordinate, dragging });
  }
  return { map, viewport, element, readout, fetchRef, move,
    setRequest: (request) => { currentRequest = request; } };
}

test('parses live ncWMS numeric and empty responses without treating coordinates as a value', () => {
  assert.equal(parseCellValue(valueXml), -2.2654);
  assert.equal(parseCellValue(emptyXml), null);
  assert.equal(parseCellValue('<FeatureInfoResponse><value>0</value></FeatureInfoResponse>'), 0);
  for (const value of ['', 'NaN', 'none', 'null']) {
    assert.equal(parseCellValue(`<FeatureInfoResponse><value>${value}</value></FeatureInfoResponse>`), null);
  }
  for (const xml of ['<ServiceExceptionReport/>', '<html>Not found</html>',
    '<FeatureInfoResponse><value>bad</value></FeatureInfoResponse>']) {
    assert.throws(() => parseCellValue(xml));
  }
});

test('formats a compact cell value with source unit labels, including zero and small values', () => {
  assert.equal(formatCellValue(-2.2654, 'Tmax', 'celsius'), 'Tmax cell: -2.2654 °C');
  assert.equal(formatCellValue(0, 'Pr', 'mm d-1'), 'Pr cell: 0 mm/day');
  assert.equal(formatCellValue(1.23456789e-9, 'Pr', 'kg m-2 s-1'), 'Pr cell: 1.23457e-9 kg m-2 s-1');
  assert.equal(formatCellValue(null, 'Tmax', 'celsius'), 'Tmax cell: No data');
  assert.equal(formatCellValue(12.4, '', ''), 'Cell: 12.4');
});

test('OpenLayers cell queries inherit the rendered variable and time across map and source CRS', () => {
  proj4.defs('EPSG:3005', '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs');
  register(proj4);
  const source = new TileWMS({ url: 'https://example.test/wms', projection: 'EPSG:4326',
    params: { LAYERS: 'tmax', VERSION: '1.3.0', TIME: '1950-01-31T00:00:00Z' } });
  const view = new View({ projection: 'EPSG:3005', resolution: 1000 });
  const coordinate = transform([-123, 49], 'EPSG:4326', 'EPSG:3005');
  const request = cellValueRequest(source, coordinate, view, 'Tmax', 'celsius');
  const params = new URL(request.url).searchParams;
  assert.equal(params.get('REQUEST'), 'GetFeatureInfo');
  assert.equal(params.get('QUERY_LAYERS'), 'tmax');
  assert.equal(params.get('TIME'), '1950-01-31T00:00:00Z');
  assert.equal(params.get('CRS'), 'EPSG:4326');
  assert.equal(params.get('INFO_FORMAT'), 'text/xml');
  assert.equal(params.get('FEATURE_COUNT'), '1');
  const [south, west, north, east] = params.get('BBOX').split(',').map(Number);
  assert.ok(south < 49 && north > 49 && west < -123 && east > -123);
  source.updateParams({ LAYERS: 'pr', TIME: '1950-02-28T00:00:00Z' });
  const next = new URL(cellValueRequest(source, coordinate, view, 'Pr', 'mm').url).searchParams;
  assert.equal(next.get('QUERY_LAYERS'), 'pr');
  assert.equal(next.get('TIME'), '1950-02-28T00:00:00Z');
});

test('coordinates display immediately and rapid pointer movement produces only one delayed query', async () => {
  const c = context();
  c.move();
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -123.00000 · Lat: 49.00000');
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(c.fetchRef.mock.calls.length, 0);
  c.move([-122, 50]);
  await vi.advanceTimersByTimeAsync(249);
  assert.equal(c.fetchRef.mock.calls.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(c.fetchRef.mock.calls.length, 1);
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -122.00000 · Lat: 50.00000 · Tmax cell: -2.2654 °C');
  c.move([-121, 51]);
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -121.00000 · Lat: 51.00000');
});

test('movement aborts the request and late responses cannot overwrite the current coordinate or value', async () => {
  const first = deferred();
  const second = deferred();
  const fetchRef = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const c = context(fetchRef);
  c.move();
  await vi.advanceTimersByTimeAsync(250);
  assert.ok(c.element.textContent.endsWith('Tmax cell: …'));
  const signal = fetchRef.mock.calls[0][1].signal;
  c.move([-122, 50]);
  assert.equal(signal.aborted, true);
  await vi.advanceTimersByTimeAsync(250);
  second.resolve(response('<FeatureInfoResponse><value>12.4</value></FeatureInfoResponse>'));
  await vi.advanceTimersByTimeAsync(0);
  first.resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -122.00000 · Lat: 50.00000 · Tmax cell: 12.4 °C');
});

test('leaving the map, map movement and CRS changes cancel pending and in-flight queries', async () => {
  for (const event of ['pointerleave', 'movestart', 'change:view']) {
    const pending = deferred();
    const c = context(vi.fn(() => pending.promise));
    c.move();
    await vi.advanceTimersByTimeAsync(250);
    if (event === 'pointerleave') c.viewport.dispatchEvent(new Event(event));
    else c.map.dispatchEvent(event);
    assert.equal(c.fetchRef.mock.calls[0][1].signal.aborted, true);
    pending.resolve(response());
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(c.element.hidden, true);
    assert.equal(c.element.textContent, '');
    c.move();
    if (event === 'pointerleave') c.viewport.dispatchEvent(new Event(event));
    else c.map.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(250);
    assert.equal(c.fetchRef.mock.calls.length, 1);
  }
});

test('dataset or time changes refresh stationary hover and discard the previous value', async () => {
  const pending = deferred();
  const fetchRef = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(response('<FeatureInfoResponse><value>5</value></FeatureInfoResponse>'));
  const c = context(fetchRef);
  c.move();
  await vi.advanceTimersByTimeAsync(250);
  c.setRequest({ url: 'https://example.test/wms?TIME=1950-02-28', label: 'Pr', units: 'mm' });
  c.readout.refresh();
  assert.equal(fetchRef.mock.calls[0][1].signal.aborted, true);
  assert.ok(!c.element.textContent.includes('cell:'));
  await vi.advanceTimersByTimeAsync(250);
  pending.resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  assert.ok(c.element.textContent.endsWith('Pr cell: 5 mm'));
  assert.equal(fetchRef.mock.calls[1][0], 'https://example.test/wms?TIME=1950-02-28');
});

test('a response from a superseded context is ignored even before the map refresh completes', async () => {
  const pending = deferred();
  const c = context(vi.fn(() => pending.promise));
  c.move();
  await vi.advanceTimersByTimeAsync(250);
  c.setRequest(null);
  pending.resolve(response());
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -123.00000 · Lat: 49.00000');
});

test('no data and request failures stay local to the readout; dragging sends no query', async () => {
  const fetchRef = vi.fn().mockResolvedValueOnce(response(emptyXml))
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValueOnce(response('<ServiceExceptionReport/>'));
  const c = context(fetchRef);
  c.move();
  await vi.advanceTimersByTimeAsync(250);
  assert.ok(c.element.textContent.endsWith('Tmax cell: No data'));
  for (let index = 0; index < 3; index += 1) {
    c.move();
    await vi.advanceTimersByTimeAsync(250);
    assert.ok(c.element.textContent.endsWith('Cell value unavailable'));
    assert.equal(c.element.hidden, false);
  }
  c.move([-122, 50], true);
  await vi.advanceTimersByTimeAsync(250);
  assert.equal(fetchRef.mock.calls.length, 4);
  assert.equal(c.element.textContent, 'EPSG:4326 · Lon: -122.00000 · Lat: 50.00000');
});
