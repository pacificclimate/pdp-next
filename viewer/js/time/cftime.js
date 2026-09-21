const SECONDS_PER_DAY = 86400;
const UNIT_SECONDS = {
  day: SECONDS_PER_DAY,
  days: SECONDS_PER_DAY,
  hour: 3600,
  hours: 3600,
  minute: 60,
  minutes: 60,
  second: 1,
  seconds: 1
};

const UNIT_ALIASES = {
  d: 'day',
  day: 'day',
  days: 'day',
  h: 'hour',
  hr: 'hour',
  hrs: 'hour',
  hour: 'hour',
  hours: 'hour',
  min: 'minute',
  mins: 'minute',
  minute: 'minute',
  minutes: 'minute',
  s: 'second',
  sec: 'second',
  secs: 'second',
  second: 'second',
  seconds: 'second'
};

const CALENDAR_ALIASES = {
  '360': '360_day',
  '365': '365_day',
  noleap: '365_day',
  all_leap: '366_day'
};

const SUPPORTED_CALENDARS = new Set([
  'standard', 'gregorian', 'proleptic_gregorian', 'julian',
  '360_day', '365_day', '366_day', 'tai'
]);

export const UNSUPPORTED_CALENDARS = new Set(['utc', 'none']);

export function isUnsupportedCalendar(calendar) {
  return UNSUPPORTED_CALENDARS.has(String(calendar || '').trim().toLowerCase());
}

export function normalizeCalendar(calendar = 'standard') {
  const value = String(calendar).trim().toLowerCase();
  if (!value) return 'standard';
  const normalized = CALENDAR_ALIASES[value] || value;
  return SUPPORTED_CALENDARS.has(normalized) ? normalized : null;
}

export function parseCfDate(value) {
  const match = String(value || '').trim().match(
    /^([+-]?\d+)(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?:[T\s](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,9}))?)?)?)?(?:\s*(Z|UTC|[+-]\d{2}:?\d{2}))?$/i
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone = ''] = match;
  let timezoneOffsetMinutes = 0;
  if (zone && !['Z', 'UTC'].includes(zone.toUpperCase())) {
    const sign = zone[0] === '+' ? 1 : -1;
    const digits = zone.slice(1).replace(':', '');
    timezoneOffsetMinutes = sign * ((Number(digits.slice(0, 2)) * 60) + Number(digits.slice(2)));
  }
  return {
    year: Number(year),
    month: month === undefined ? null : Number(month),
    day: day === undefined ? null : Number(day),
    hour: hour === undefined ? 0 : Number(hour),
    minute: minute === undefined ? 0 : Number(minute),
    second: second === undefined ? 0 : Number(second),
    millisecond: Number(`0.${fraction}`) * 1000,
    timezoneOffsetMinutes,
    precision: month === undefined ? 'year' : (day === undefined ? 'month' : 'day')
  };
}

export function parseCfUnits(units) {
  const match = String(units || '').trim().match(/^\s*([a-z]+)\s+since\s+(.+)\s*$/i);
  if (!match) return null;
  const unit = UNIT_ALIASES[match[1].toLowerCase()];
  const origin = parseCfDate(match[2]);
  if (!unit || !origin || origin.day === null) return null;
  return { unit, origin };
}

function isGregorianLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isJulianLeapYear(year) {
  return year % 4 === 0;
}

function daysInMonth(year, month, calendar) {
  if (month < 1 || month > 12) return 0;
  if (calendar === '360_day') return 30;
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month !== 2) return lengths[month - 1];
  if (calendar === '366_day') return 29;
  if (calendar === '365_day') return 28;
  const usesJulianLeapRule = calendar === 'julian'
    || ((calendar === 'standard' || calendar === 'gregorian') && year < 1582);
  const leap = usesJulianLeapRule
    ? isJulianLeapYear(year)
    : isGregorianLeapYear(year);
  return leap ? 29 : 28;
}

function isStandardGap(date) {
  return date.year === 1582 && date.month === 10 && date.day >= 5 && date.day <= 14;
}

export function validateCfDate(date, calendar = 'standard') {
  const normalizedCalendar = normalizeCalendar(calendar);
  const supportsYearZero = ['proleptic_gregorian', '360_day', '365_day', '366_day'].includes(normalizedCalendar);
  if (!normalizedCalendar || !date || !Number.isInteger(date.year)
    || (!supportsYearZero && date.year < 1) || !Number.isInteger(date.month)) return false;
  if (date.day === null || !Number.isInteger(date.day)) return false;
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month, normalizedCalendar)) return false;
  if (normalizedCalendar === 'standard' || normalizedCalendar === 'gregorian') {
    if (isStandardGap(date)) return false;
  }
  if (normalizedCalendar === 'tai') {
    if (date.year < 1958 || date.timezoneOffsetMinutes !== 0) return false;
  }
  return Number.isFinite(date.hour) && date.hour >= 0 && date.hour < 24
    && Number.isFinite(date.minute) && date.minute >= 0 && date.minute < 60
    && Number.isFinite(date.second) && date.second >= 0 && date.second < 60
    && Number.isFinite(date.millisecond) && date.millisecond >= 0 && date.millisecond < 1000;
}

function gregorianJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + (12 * a) - 3;
  return day + Math.floor(((153 * m) + 2) / 5) + (365 * y)
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

function julianJdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + (12 * a) - 3;
  return day + Math.floor(((153 * m) + 2) / 5) + (365 * y) + Math.floor(y / 4) - 32083;
}

function dayNumber(date, calendar) {
  if (calendar === '360_day') return (date.year * 360) + ((date.month - 1) * 30) + date.day;
  if (calendar === '365_day' || calendar === '366_day') {
    const yearDays = calendar === '365_day' ? 365 : 366;
    let days = date.year * yearDays;
    for (let month = 1; month < date.month; month += 1) days += daysInMonth(date.year, month, calendar);
    return days + date.day;
  }
  if (calendar === 'julian') return julianJdn(date.year, date.month, date.day);
  if (calendar === 'standard' || calendar === 'gregorian') {
    const beforeTransition = date.year < 1582
      || (date.year === 1582 && (date.month < 10 || (date.month === 10 && date.day <= 4)));
    return beforeTransition
      ? julianJdn(date.year, date.month, date.day)
      : gregorianJdn(date.year, date.month, date.day);
  }
  return gregorianJdn(date.year, date.month, date.day);
}

function secondsOfDay(date) {
  return (date.hour * 3600) + (date.minute * 60) + date.second
    + (date.millisecond / 1000) - (date.timezoneOffsetMinutes * 60);
}

export function dateToCfNumber(value, units, calendar = 'standard') {
  const date = typeof value === 'string' ? parseCfDate(value) : value;
  const parsedUnits = parseCfUnits(units);
  const normalizedCalendar = normalizeCalendar(calendar);
  if (!date || !parsedUnits || !UNIT_SECONDS[parsedUnits.unit]
    || !validateCfDate(date, normalizedCalendar)
    || !validateCfDate(parsedUnits.origin, normalizedCalendar)) return null;
  const seconds = ((dayNumber(date, normalizedCalendar) - dayNumber(parsedUnits.origin, normalizedCalendar)) * SECONDS_PER_DAY)
    + secondsOfDay(date) - secondsOfDay(parsedUnits.origin);
  return seconds / UNIT_SECONDS[parsedUnits.unit];
}

function boundaryDate(value, boundary, calendar) {
  const date = parseCfDate(value);
  const normalizedCalendar = normalizeCalendar(calendar);
  if (!calendar || !date || (date.month !== null && (date.month < 1 || date.month > 12))) return null;
  if (date.month === null) {
    date.month = boundary === 'end' ? 12 : 1;
  }
  if (date.day === null) {
    date.day = boundary === 'end' ? daysInMonth(date.year, date.month, normalizedCalendar) : 1;
  }
  if (!validateCfDate(date, normalizedCalendar)) return null;
  return date;
}

function formatCfDate(date) {
  const year = String(date.year).padStart(4, '0');
  return `${year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function describeBoundaryError(value, boundary, calendar) {
  const label = boundary === 'start' ? 'Start' : 'End';
  const date = parseCfDate(value);
  if (!date) {
    return `${label} date must use YYYY, YYYY-MM, or YYYY-MM-DD.`;
  }
  if (date.month !== null && (date.month < 1 || date.month > 12)) {
    return `${label} date "${value}" has an invalid month; use a month from 01 through 12.`;
  }
  if (date.day !== null && date.month !== null) {
    const maxDay = daysInMonth(date.year, date.month, calendar);
    if (date.day < 1 || date.day > maxDay) {
      const nearest = Math.max(1, Math.min(date.day, maxDay));
      return `${label} date "${value}" is invalid for the ${calendar} calendar: `
        + `${formatCfDate({ ...date, day: nearest })} is the nearest valid date.`;
    }
  }
  if ((calendar === 'standard' || calendar === 'gregorian') && isStandardGap(date)) {
    return `${label} date "${value}" is in the ${calendar} calendar gap; `
      + 'use a date on or before 1582-10-04 or on or after 1582-10-15.';
  }
  return `${label} date "${value}" is not valid for the ${calendar} calendar.`;
}

export function describeCfDateRangeError(startValue, endValue, calendar = 'standard') {
  const normalizedCalendar = normalizeCalendar(calendar);
  if (!normalizedCalendar) return null;
  const start = boundaryDate(startValue, 'start', normalizedCalendar);
  if (!start) return { field: 'start', message: describeBoundaryError(startValue, 'start', normalizedCalendar) };
  const end = boundaryDate(endValue, 'end', normalizedCalendar);
  if (!end) return { field: 'end', message: describeBoundaryError(endValue, 'end', normalizedCalendar) };
  if (dayNumber(start, normalizedCalendar) > dayNumber(end, normalizedCalendar)) {
    return {
      field: 'range',
      message: `Start date "${startValue}" must be earlier than end date "${endValue}" for the ${normalizedCalendar} calendar.`
    };
  }
  return null;
}

function nextDay(date, calendar) {
  const result = { ...date, hour: 0, minute: 0, second: 0, millisecond: 0, timezoneOffsetMinutes: 0 };
  result.day += 1;
  if (result.day > daysInMonth(result.year, result.month, calendar)) {
    result.day = 1;
    result.month += 1;
    if (result.month > 12) {
      result.month = 1;
      result.year += 1;
    }
  }
  if ((calendar === 'standard' || calendar === 'gregorian') && isStandardGap(result)) {
    result.day = 15;
  }
  return result;
}

/** Converts UI date tokens to inclusive numeric CF-coordinate bounds. */
export function dateRangeToCfBounds(startValue, endValue, units, calendar = 'standard') {
  const normalizedCalendar = normalizeCalendar(calendar);
  const start = boundaryDate(startValue, 'start', normalizedCalendar);
  const end = boundaryDate(endValue, 'end', normalizedCalendar);
  if (!start || !end) return null;
  start.hour = 0;
  start.minute = 0;
  start.second = 0;
  start.millisecond = 0;
  start.timezoneOffsetMinutes = 0;
  end.hour = 0;
  end.minute = 0;
  end.second = 0;
  end.millisecond = 0;
  end.timezoneOffsetMinutes = 0;
  const lower = dateToCfNumber(start, units, normalizedCalendar);
  const next = dateToCfNumber(nextDay(end, normalizedCalendar), units, normalizedCalendar);
  if (!Number.isFinite(lower) || !Number.isFinite(next) || lower >= next) return null;
  return [lower, next - Math.max(1e-9, Math.abs(next) * Number.EPSILON * 4)];
}
