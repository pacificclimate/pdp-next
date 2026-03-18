export function createSubsetIndexController({
  state,
  fetchText,
  dodsBaseForUrlPath
}) {
  function parseAsciiDimensionValues(text, varName) {
    const values = [];
    const lineRegex = new RegExp(`^\\s*${varName}\\[\\d+\\],\\s*([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)\\s*$`);
    text.split(/\r?\n/).forEach((line) => {
      const match = line.match(lineRegex);
      if (match) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) values.push(value);
      }
    });
    if (values.length) return values;
    const fallback = [];
    const fallbackRegex = /,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let match;
    while ((match = fallbackRegex.exec(text)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) fallback.push(value);
    }
    return fallback;
  }

  async function fetchOpendapDimensionValues(urlPath, dimName) {
    const asciiUrl = `${dodsBaseForUrlPath(urlPath)}.ascii?${encodeURIComponent(dimName)}`;
    const text = await fetchText(asciiUrl);
    const values = parseAsciiDimensionValues(text, dimName);
    if (!values.length) throw new Error(`Could not parse ${dimName} values from OpenDAP ASCII`);
    return values;
  }

  function findBoundedIndexRange(values, lower, upper) {
    const lo = Math.min(lower, upper);
    const hi = Math.max(lower, upper);
    let first = -1;
    let last = -1;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (value >= lo && value <= hi) {
        if (first === -1) first = index;
        last = index;
      }
    }
    if (first >= 0 && last >= 0) return [first, last];

    let nearestLo = 0;
    let nearestHi = 0;
    let nearestLoDist = Number.POSITIVE_INFINITY;
    let nearestHiDist = Number.POSITIVE_INFINITY;
    values.forEach((value, index) => {
      const dLo = Math.abs(value - lo);
      const dHi = Math.abs(value - hi);
      if (dLo < nearestLoDist) {
        nearestLoDist = dLo;
        nearestLo = index;
      }
      if (dHi < nearestHiDist) {
        nearestHiDist = dHi;
        nearestHi = index;
      }
    });
    return [Math.min(nearestLo, nearestHi), Math.max(nearestLo, nearestHi)];
  }

  function findTimeIndexRange(isoTimes, startIso, endIso) {
    if (!Array.isArray(isoTimes) || !isoTimes.length) return [0, 0];
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return [0, isoTimes.length - 1];
    }
    let first = -1;
    let last = -1;
    for (let index = 0; index < isoTimes.length; index += 1) {
      const ms = Date.parse(isoTimes[index]);
      if (!Number.isFinite(ms)) continue;
      if (ms >= startMs && ms <= endMs) {
        if (first === -1) first = index;
        last = index;
      }
    }
    if (first >= 0 && last >= 0) return [first, last];
    return [0, isoTimes.length - 1];
  }

  async function getNcpartitionerIndexInfo(urlPath) {
    const key = String(urlPath || '');
    if (state.ncpIndexCache[key]) return state.ncpIndexCache[key];
    const [lat, lon] = await Promise.all([
      fetchOpendapDimensionValues(urlPath, 'lat'),
      fetchOpendapDimensionValues(urlPath, 'lon')
    ]);
    const indexInfo = { lat, lon };
    state.ncpIndexCache[key] = indexInfo;
    return indexInfo;
  }

  return {
    findBoundedIndexRange,
    findTimeIndexRange,
    getNcpartitionerIndexInfo
  };
}
