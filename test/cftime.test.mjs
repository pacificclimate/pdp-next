import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  cfNumberToIso,
  dateRangeToCfBounds,
  describeCfDateRangeError,
  dateToCfNumber,
  isUnsupportedCalendar,
  normalizeCalendar,
  parseCfDate,
  parseCfUnits,
  validateCfDate
} from '../viewer/js/time/cftime.js';
import { createSubsetIndexController, parseAsciiDimensionValues } from '../viewer/js/subsetting/indexes.js';

test('normalizes supported CF calendar aliases', () => {
  assert.equal(normalizeCalendar(), 'standard');
  assert.equal(normalizeCalendar('360'), '360_day');
  assert.equal(normalizeCalendar('365'), '365_day');
  assert.equal(normalizeCalendar('noleap'), '365_day');
  assert.equal(normalizeCalendar('all_leap'), '366_day');
});

test('parses calendar-neutral year, month, and full-date tokens', () => {
  assert.deepEqual(parseCfDate('1981'), {
    year: 1981, month: null, day: null, hour: 0, minute: 0, second: 0,
    millisecond: 0, timezoneOffsetMinutes: 0, precision: 'year'
  });
  assert.equal(parseCfDate('1981-02').precision, 'month');
  assert.equal(parseCfDate('1981-02-30 12:34:56').day, 30);
});

test('validates calendar-specific dates and CF standard transition', () => {
  assert.equal(validateCfDate(parseCfDate('1981-02-30'), '360_day'), true);
  assert.equal(validateCfDate(parseCfDate('1981-12-31'), '360_day'), false);
  assert.equal(validateCfDate(parseCfDate('1980-02-29'), '365_day'), false);
  assert.equal(validateCfDate(parseCfDate('1981-02-29'), '366_day'), true);
  assert.equal(validateCfDate(parseCfDate('1900-02-29'), 'proleptic_gregorian'), false);
  assert.equal(validateCfDate(parseCfDate('2000-02-29'), 'proleptic_gregorian'), true);
  assert.equal(validateCfDate(parseCfDate('1900-02-29'), 'julian'), true);
  assert.equal(validateCfDate(parseCfDate('1582-10-10'), 'standard'), false);
  assert.equal(dateToCfNumber('1582-10-15', 'days since 1582-10-04', 'standard'), 1);
  assert.equal(dateToCfNumber('1582-10-15', 'days since 1582-10-04', 'gregorian'), 1);
  assert.equal(dateToCfNumber('1900-03-01', 'days since 1900-02-28', 'julian'), 2);
});

test('explains invalid CF date boundaries', () => {
  const cases = [
    ['not-a-date', '1981-01-01', '360_day', 'start', 'Start date must use YYYY, YYYY-MM, or YYYY-MM-DD.'],
    ['1981-13-01', '1981-01-01', '360_day', 'start', 'Start date "1981-13-01" has an invalid month; use a month from 01 through 12.'],
    ['1981-01-01', '1981-12-31', '360_day', 'end', 'End date "1981-12-31" is invalid for the 360_day calendar: 1981-12-30 is the nearest valid date.'],
    ['1582-10-10', '1582-10-15', 'standard', 'start', 'Start date "1582-10-10" is in the standard calendar gap; use a date on or before 1582-10-04 or on or after 1582-10-15.'],
    ['1957-01-01', '1958-01-01', 'tai', 'start', 'Start date "1957-01-01" is not valid for the tai calendar.'],
    ['1981-02-01', '1981-01-01', '360_day', 'range', 'Start date "1981-02-01" must be earlier than end date "1981-01-01" for the 360_day calendar.']
  ];
  cases.forEach(([start, end, calendar, field, message]) => {
    assert.deepEqual(describeCfDateRangeError(start, end, calendar), { field, message });
  });
});

test('BCCAQv2 360_day regression selects the actual 1981 daily-noon coordinate range', () => {
  const units = 'days since 1950-01-01';
  assert.equal(dateToCfNumber('1981-01-01', units, '360_day'), 11160);
  const values = Array.from({ length: 360 }, (_, index) => 11160.5 + index);
  // A year-only end expands to the final valid 360_day date (December 30).
  const bounds = dateRangeToCfBounds('1981-01-01', '1981', units, '360_day');
  const indexes = createSubsetIndexController({
    state: { ncpIndexCache: {} }, fetchText: async () => '', dodsBaseForUrlPath: () => ''
  }).findBoundedIndexRange(values, ...bounds);
  assert.deepEqual(indexes, [0, 359]);
  assert.equal(values[indexes[0]], 11160.5);
  assert.equal(values[indexes[1]], 11519.5);
  assert.equal(dateRangeToCfBounds('1981-01-01', '1981-12-31', units, '360_day'), null);
});

test('converts raw 360_day coordinates to their calendar dates for WMS', () => {
  const units = 'days since 1950-01-01';
  assert.equal(cfNumberToIso(11160.5, units, '360_day'), '1981-01-01T12:00:00Z');
  assert.equal(cfNumberToIso(11519.5, units, '360_day'), '1981-12-30T12:00:00Z');
  assert.equal(cfNumberToIso(30.5, 'days since 1981-01-01', '360_day'), '1981-02-01T12:00:00Z');
});

test('converts standard-calendar coordinates through the same CF path', () => {
  assert.equal(
    cfNumberToIso(365.5, 'days since 1981-01-01', 'standard'),
    '1982-01-01T12:00:00Z'
  );
  assert.equal(
    cfNumberToIso(365.5, 'days since 1981-01-01'),
    '1982-01-01T12:00:00Z'
  );
});

test('accepts source endpoint dates when coordinates occur at noon', () => {
  const units = 'days since 1950-01-01';
  const first = cfNumberToIso(0.5, units, 'standard').slice(0, 10);
  const lastCoordinate = dateToCfNumber('2100-12-31', units, 'standard') + 0.5;
  const last = cfNumberToIso(lastCoordinate, units, 'standard').slice(0, 10);
  const available = dateRangeToCfBounds(first, last, units, 'standard');
  const requested = dateRangeToCfBounds('1950-01-01', '2100-12-31', units, 'standard');

  assert.deepEqual([first, last], ['1950-01-01', '2100-12-31']);
  assert.deepEqual(requested, available);
});

test('selects the same 360_day dates from descending coordinates', () => {
  const units = 'days since 1950-01-01';
  const ascending = Array.from({ length: 360 }, (_, index) => 11160.5 + index);
  const descending = [...ascending].reverse();
  const bounds = dateRangeToCfBounds('1981-02', '1981-02', units, '360_day');
  const { findBoundedIndexRange } = createSubsetIndexController({
    state: { ncpIndexCache: {} }, fetchText: async () => '', dodsBaseForUrlPath: () => ''
  });

  assert.deepEqual(findBoundedIndexRange(ascending, ...bounds), [30, 59]);
  assert.deepEqual(findBoundedIndexRange(descending, ...bounds), [300, 329]);
});

test('includes exact day boundaries and uses the nearest sparse time coordinate', () => {
  const controller = createSubsetIndexController({
    state: { ncpIndexCache: {} }, fetchText: async () => '', dodsBaseForUrlPath: () => ''
  });
  const exactBounds = dateRangeToCfBounds('1981-01-01', '1981-01-01', 'days since 1981-01-01', '360_day');
  assert.deepEqual(controller.findBoundedIndexRange([0, 0.5, 1], ...exactBounds), [0, 1]);

  const sparseBounds = dateRangeToCfBounds('1981-02-01', '1981-02-01', 'days since 1981-01-01', '360_day');
  assert.deepEqual(controller.findBoundedIndexRange([14.5, 45.5], ...sparseBounds), [0, 1]);
});

test('selects calendar-length years and uses actual monthly coordinates', () => {
  const select = (calendar, values) => {
    const bounds = dateRangeToCfBounds('1980', '1980', 'days since 1980-01-01', calendar);
    return values.filter((value) => value >= bounds[0] && value <= bounds[1]).length;
  };
  assert.equal(select('365_day', Array.from({ length: 365 }, (_, index) => index + 0.5)), 365);
  assert.equal(select('proleptic_gregorian', Array.from({ length: 366 }, (_, index) => index + 0.5)), 366);
  const ordinaryBounds = dateRangeToCfBounds('1981', '1981', 'days since 1980-01-01', 'proleptic_gregorian');
  assert.equal(Array.from({ length: 365 }, (_, index) => 366.5 + index)
    .filter((value) => value >= ordinaryBounds[0] && value <= ordinaryBounds[1]).length, 365);
  assert.equal(select('proleptic_gregorian', [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]), 12);
});

test('ncpartitioner index info retains raw OpenDAP time values', async () => {
  const controller = createSubsetIndexController({
    state: { ncpIndexCache: {}, currentDataset: { timeMetadata: { count: 2 } } },
    fetchText: async (url) => {
      if (url.endsWith('lat')) return 'lat[0], 50\n';
      if (url.endsWith('lon')) return 'lon[0], -120\n';
      return 'time[0], 11160.5\ntime[1], 11161.5\n';
    },
    dodsBaseForUrlPath: () => 'https://example.test/data'
  });
  const info = await controller.getNcpartitionerIndexInfo('/data.nc');

  assert.deepEqual(info.time, [11160.5, 11161.5]);
  assert.equal(info.timeCount, 2);
});

test('ncpartitioner reuses the time coordinate fetched for a CF slider', async () => {
  let requestedTime = false;
  const controller = createSubsetIndexController({
    state: {
      ncpIndexCache: {},
      timeCoordinateCache: { '/data.nc': [11160.5, 11161.5] },
      currentDataset: { timeMetadata: { count: 2 } }
    },
    fetchText: async (url) => {
      if (url.endsWith('time')) requestedTime = true;
      if (url.endsWith('lat')) return 'lat[0], 50\n';
      return 'lon[0], -120\n';
    },
    dodsBaseForUrlPath: () => 'https://example.test/data'
  });
  const info = await controller.getNcpartitionerIndexInfo('/data.nc');

  assert.equal(requestedTime, false);
  assert.deepEqual(info.time, [11160.5, 11161.5]);
});

test('ncpartitioner index info retains the first OpenDAP block value', async () => {
  const controller = createSubsetIndexController({
    state: { ncpIndexCache: {}, currentDataset: { timeMetadata: { count: 3 } } },
    fetchText: async (url) => {
      if (url.endsWith('lat')) return 'lat[1]\n50\n';
      if (url.endsWith('lon')) return 'lon[1]\n-120\n';
      return 'time[3]\n11160.5, 11161.5, 11162.5\n';
    },
    dodsBaseForUrlPath: () => 'https://example.test/data'
  });
  const info = await controller.getNcpartitionerIndexInfo('/data.nc');

  assert.deepEqual(info.time, [11160.5, 11161.5, 11162.5]);
  assert.deepEqual(controller.findBoundedIndexRange(info.time, 11160, 11162), [0, 1]);
});

test('parses a THREDDS OpenDAP coordinate block for slider timestamps', () => {
  assert.deepEqual(
    parseAsciiDimensionValues('time[3]\n11160.5, 11161.5, 11162.5\n', 'time'),
    [11160.5, 11161.5, 11162.5]
  );
});

test('range ending on 1582-10-04 skips the standard-calendar gap', () => {
  assert.notEqual(dateRangeToCfBounds('1582-10-01', '1582-10-04', 'days since 1582-01-01', 'standard'), null);
});

test('reversed range one day apart is rejected', () => {
  assert.equal(dateRangeToCfBounds('2000-01-02', '2000-01-01', 'days since 2000-01-01', 'standard'), null);
});

test('hour/minute/second units scale correctly', () => {
  assert.equal(dateToCfNumber('1981-01-02', 'hours since 1981-01-01', '365_day'), 24);
  assert.equal(dateToCfNumber('1981-01-02', 'minutes since 1981-01-01', '365_day'), 1440);
  assert.equal(dateToCfNumber('1981-01-02', 'seconds since 1981-01-01', '365_day'), 86400);
});

test('month token expands to calendar-specific last day', () => {
  // 360_day February has 30 days: Feb 1 .. Feb 30 inclusive = 30 days
  const [lo, hi] = dateRangeToCfBounds('1981-02', '1981-02', 'days since 1981-01-01', '360_day');
  assert.equal(lo, 30);
  assert.ok(hi > 59.99 && hi < 60);
});

test('all_leap year has 366 days', () => {
  const [lo, hi] = dateRangeToCfBounds('1981', '1981', 'days since 1981-01-01', 'all_leap');
  assert.equal(Array.from({ length: 366 }, (_, i) => i).filter((v) => v >= lo && v <= hi).length, 366);
});

test('selects complete noleap and standard-calendar years', () => {
  const select = (calendar, year, length) => {
    const bounds = dateRangeToCfBounds(year, year, `days since ${year}-01-01`, calendar);
    return Array.from({ length }, (_, index) => index + 0.5)
      .filter((value) => value >= bounds[0] && value <= bounds[1]).length;
  };
  assert.equal(select('noleap', '1980', 365), 365);
  assert.equal(select('standard', '1981', 365), 365);
});

test('supports astronomical years for idealized and proleptic calendars', () => {
  assert.equal(dateToCfNumber('0000-01-01', 'days since 0000-01-01', '360_day'), 0);
  assert.equal(dateToCfNumber('-0001-01-01', 'days since -0001-01-01', 'proleptic_gregorian'), 0);
  assert.equal(dateToCfNumber('0000-01-01', 'days since 0000-01-01', 'standard'), null);
});

test('accepts common CF unit spellings and legacy reference datetimes', () => {
  const parsed = parseCfUnits('hr since 1970-1-1 0:0:0 UTC');
  assert.equal(parsed.unit, 'hour');
  assert.equal(parsed.origin.year, 1970);
  assert.equal(parsed.origin.month, 1);
  assert.equal(dateToCfNumber('1970-1-1 1:0:0', 'h since 1970-1-1 0:0:0 +0000', 'standard'), 1);
  assert.equal(dateToCfNumber('1970-1-1 0:0:1', 'sec since 1970-1-1 0:0:0', 'standard'), 1);
});

test('rejects unknown CF calendars instead of assuming Gregorian', () => {
  assert.equal(normalizeCalendar('noleep'), null);
  assert.equal(dateToCfNumber('1981-01-01', 'days since 1981-01-01', 'noleep'), null);
});

test('supports TAI but explicitly rejects calendars needing extra semantics', () => {
  assert.equal(dateToCfNumber('1958-01-01', 'seconds since 1958-01-01', 'tai'), 0);
  assert.equal(dateToCfNumber('1957-12-31', 'seconds since 1958-01-01', 'tai'), null);
  assert.equal(dateToCfNumber('1958-01-01 00:00 +0100', 'seconds since 1958-01-01', 'tai'), null);
  assert.equal(isUnsupportedCalendar('utc'), true);
  assert.equal(isUnsupportedCalendar('none'), true);
  assert.equal(isUnsupportedCalendar('tai'), false);
});
