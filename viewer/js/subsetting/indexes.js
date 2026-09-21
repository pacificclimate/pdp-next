// THREDDS may render a one-dimensional DAP ASCII response either one value per
// line or as a header followed by a comma-separated block.
export function parseAsciiDimensionValues(text, varName) {
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
  const blockHeader = new RegExp(`^\\s*${varName}\\[\\d+\\]\\s*$`, 'm').exec(text);
  const blockValues = blockHeader
    ? text.slice(blockHeader.index + blockHeader[0].length)
    : text;
  const fallbackRegex = blockHeader
    ? /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g
    : /,\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let match;
  while ((match = fallbackRegex.exec(blockValues)) !== null) {
    const value = Number(blockHeader ? match[0] : match[1]);
    if (Number.isFinite(value)) fallback.push(value);
  }
  return fallback;
}

export function createSubsetIndexController({
  state,
  fetchText,
  dodsBaseForUrlPath
}) {
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

  async function getNcpartitionerIndexInfo(urlPath) {
    const key = String(urlPath || '');
    if (state.ncpIndexCache[key]) return state.ncpIndexCache[key];
    const metadataTimeCount = Number(state.currentDataset?.timeMetadata?.count || state.times?.length || 0);
    const cachedTime = state.timeCoordinateCache?.[key];
    const [lat, lon, time] = await Promise.all([
      fetchOpendapDimensionValues(urlPath, 'lat'),
      fetchOpendapDimensionValues(urlPath, 'lon'),
      // A climatology has exactly one known time index. Avoid requesting its
      // scalar coordinate from OpenDAP; ncpartitioner needs index 0.
      cachedTime || (metadataTimeCount === 1
        ? Promise.resolve([0])
        : fetchOpendapDimensionValues(urlPath, 'time'))
    ]);
    const indexInfo = { lat, lon, time, timeCount: time.length };
    state.ncpIndexCache[key] = indexInfo;
    return indexInfo;
  }

  return {
    findBoundedIndexRange,
    getNcpartitionerIndexInfo
  };
}
