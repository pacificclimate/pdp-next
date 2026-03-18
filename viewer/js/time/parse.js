export function createTimeParseHelpers({ state, TIME_EXPAND_LIMIT }) {
  function parseIsoDuration(duration) {
    if (!duration || !duration.startsWith('P')) return null;
    const match = duration.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!match) return null;
    let [, years, months, weeks, days, hours, minutes, seconds] = match;
    years = parseFloat(years) || 0;
    months = parseFloat(months) || 0;
    weeks = parseFloat(weeks) || 0;
    days = parseFloat(days) || 0;
    hours = parseFloat(hours) || 0;
    minutes = parseFloat(minutes) || 0;
    seconds = parseFloat(seconds) || 0;
    const msPerDay = 86400000;
    return ((years * 365 + months * 30 + weeks * 7 + days) * msPerDay)
      + (hours * 3600000)
      + (minutes * 60000)
      + (seconds * 1000);
  }

  function extractIsoBase(isoString) {
    if (!isoString || isoString === '—') return isoString;
    const chunks = String(isoString).split('/');
    return (chunks[0] || isoString).trim();
  }

  function isSeasonToken(value) {
    return /^(DJF|MAM|JJA|SON)$/i.test(String(value || '').trim());
  }

  function isMonthToken(value) {
    const raw = String(value || '').trim().toLowerCase();
    return /^(?:[1-9]|1[0-2])$/.test(raw)
      || ['jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september', 'oct', 'october', 'nov', 'november', 'dec', 'december'].includes(raw);
  }

  function parseTimeValueToDate(raw) {
    if (raw === undefined || raw === null) return null;
    const value = String(raw).trim();
    if (!value) return null;
    if (isSeasonToken(value) || isMonthToken(value)) return null;

    const isoBase = extractIsoBase(value);
    const direct = new Date(isoBase);
    if (!Number.isNaN(direct.getTime())) return direct;

    const numeric = parseFloat(value);
    if (!Number.isFinite(numeric)) return null;

    const unitsRaw = state.layerDetails?.metadata?.time?.units || 'days since 1981-01-01';
    const lowerUnits = String(unitsRaw).toLowerCase();
    const sinceIndex = lowerUnits.indexOf('since');
    if (sinceIndex === -1) return null;

    const unitToken = lowerUnits.slice(0, sinceIndex).trim();
    const basePart = String(unitsRaw).slice(sinceIndex + 5).trim();
    const baseDate = new Date(basePart);
    if (Number.isNaN(baseDate.getTime())) return null;

    let multiplier = 86400000;
    if (unitToken.startsWith('hour')) multiplier = 3600000;
    else if (unitToken.startsWith('min')) multiplier = 60000;
    else if (unitToken.startsWith('sec')) multiplier = 1000;

    return new Date(baseDate.getTime() + numeric * multiplier);
  }

  function expandTimeRange(spec) {
    const parts = String(spec).split('/');
    if (parts.length !== 3) return [String(spec).trim()];
    const start = parseTimeValueToDate(parts[0]);
    const end = parseTimeValueToDate(parts[1]);
    const stepMs = parseIsoDuration(parts[2]);
    if (!start || !end || !stepMs) return [parts[0].trim()];
    const list = [];
    for (let ts = start.getTime(); ts <= end.getTime(); ts += stepMs) {
      list.push(new Date(ts).toISOString());
    }
    return list;
  }

  function normalizeIsoString(value) {
    const date = parseTimeValueToDate(value);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : String(value).trim();
  }

  function normalizeTimeEntries(entries = []) {
    const seen = new Set();
    const normalized = [];
    entries.forEach((entry) => {
      if (!entry) return;
      const raw = String(entry).trim();
      if (!raw) return;
      const expanded = raw.includes('/') ? expandTimeRange(raw) : [raw];
      expanded.forEach((time) => {
        const normalizedTime = normalizeIsoString(time);
        if (!normalizedTime || seen.has(normalizedTime)) return;
        seen.add(normalizedTime);
        normalized.push(normalizedTime);
      });
    });
    return normalized;
  }

  // TIME_EXPAND_LIMIT guards against runaway expansion of WMS dimension strings
  // (e.g. hourly data over decades), but we pass all timesteps through here so the
  // slider stays 1:1 with the data. Subsampling would cause the stepper to skip days.
  function capTimesPreserveEnds(times) {
    return Array.isArray(times) ? times : [];
  }

  function normalizeTimesFromDimension(raw) {
    const text = String(raw || '').trim();
    if (!text) return { times: [], start: '', end: '', raw: '' };
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    const normalized = normalizeTimeEntries(parts);
    const trimmed = capTimesPreserveEnds(normalized, TIME_EXPAND_LIMIT);
    return { times: trimmed, start: trimmed[0] || '', end: trimmed[trimmed.length - 1] || '', raw: text };
  }

  function normalizeTimeToken(value) {
    if (value == null) return '';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return String(value).trim();
  }

  function isTimeLikeToken(token) {
    const text = String(token || '').trim();
    return !!text && (!Number.isNaN(Date.parse(text)) || Number.isFinite(parseFloat(text)) || isSeasonToken(text) || isMonthToken(text));
  }

  function extractTimeTokens(input, out = []) {
    if (input == null) return out;
    if (Array.isArray(input)) {
      input.forEach((item) => extractTimeTokens(item, out));
      return out;
    }
    if (typeof input === 'object') {
      const keys = Object.keys(input || {});
      const timeishKeys = keys.filter(isTimeLikeToken);
      if (timeishKeys.length) timeishKeys.forEach((key) => out.push(normalizeTimeToken(key)));
      const preferredFields = ['time', 'value', 'date', 'datetime', 'timeString', 'timestamp', 'label', 'name'];
      for (const field of preferredFields) {
        if (Object.prototype.hasOwnProperty.call(input, field)) extractTimeTokens(input[field], out);
      }
      keys.forEach((key) => {
        if (!preferredFields.includes(key)) extractTimeTokens(input[key], out);
      });
      return out;
    }
    const token = normalizeTimeToken(input);
    if (token) out.push(token);
    return out;
  }

  function formatSeasonLabel(isoTime) {
    const raw = String(isoTime || '').trim();
    if (/^(DJF|MAM|JJA|SON)$/i.test(raw)) return raw.toUpperCase();
    const dt = new Date(isoTime);
    if (Number.isNaN(dt.getTime())) return String(isoTime || '');
    const month = dt.getUTCMonth() + 1;
    if ([12, 1, 2].includes(month)) return 'DJF';
    if ([3, 4, 5].includes(month)) return 'MAM';
    if ([6, 7, 8].includes(month)) return 'JJA';
    if ([9, 10, 11].includes(month)) return 'SON';
    return dt.toISOString().slice(0, 10);
  }

  function formatMonthLabel(timeValue) {
    const raw = String(timeValue || '').trim();
    const monthMap = {
      jan: 'Jan', january: 'Jan', feb: 'Feb', february: 'Feb', mar: 'Mar', march: 'Mar',
      apr: 'Apr', april: 'Apr', may: 'May', jun: 'Jun', june: 'Jun', jul: 'Jul', july: 'Jul',
      aug: 'Aug', august: 'Aug', sep: 'Sep', sept: 'Sep', september: 'Sep', oct: 'Oct',
      october: 'Oct', nov: 'Nov', november: 'Nov', dec: 'Dec', december: 'Dec'
    };
    const lowered = raw.toLowerCase();
    if (monthMap[lowered]) return monthMap[lowered];
    if (/^(?:[1-9]|1[0-2])$/.test(raw)) {
      const idx = parseInt(raw, 10) - 1;
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][idx];
    }
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()];
    }
    return raw;
  }

  function formatDailyLabel(timeValue) {
    const dt = parseTimeValueToDate(timeValue) || new Date(String(timeValue || '').trim());
    if (Number.isNaN(dt.getTime())) return String(timeValue || '');
    return dt.toISOString().slice(0, 10);
  }

  function toDateInputValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const dt = new Date(text);
    if (Number.isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function parseSubsetDateValue(value, boundary = 'start') {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = text.replace(/\//g, '-');
    const yearOnly = normalized.match(/^(\d{4})$/);
    if (yearOnly) {
      const year = Number(yearOnly[1]);
      if (!Number.isFinite(year)) return null;
      return boundary === 'end'
        ? new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString()
        : new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString();
    }
    const yearMonth = normalized.match(/^(\d{4})-(\d{2})$/);
    if (yearMonth) {
      const year = Number(yearMonth[1]);
      const monthIndex = Number(yearMonth[2]) - 1;
      if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return null;
      if (boundary === 'end') return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999)).toISOString();
      return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)).toISOString();
    }
    const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const monthIndex = Number(dateOnly[2]) - 1;
      const day = Number(dateOnly[3]);
      if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
      return boundary === 'end'
        ? new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999)).toISOString()
        : new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0)).toISOString();
    }
    const dt = new Date(normalized);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  }

  return {
    normalizeTimesFromDimension,
    extractTimeTokens,
    normalizeTimeEntries,
    isTimeLikeToken,
    formatSeasonLabel,
    formatMonthLabel,
    formatDailyLabel,
    toDateInputValue,
    parseSubsetDateValue
  };
}