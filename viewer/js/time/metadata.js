export function createTimeMetadataController({
  fetchText,
  parseHelpers
}) {
  const {
    extractTimeTokens,
    normalizeTimeEntries,
    isTimeLikeToken,
    normalizeTimesFromDimension
  } = parseHelpers;

  function deriveTimesFromLayerDetails(details) {
    const candidates = [details?.datesWithData, details?.timesteps, details?.timeSteps, details?.times, details?.availableTimes];
    let values = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      values = extractTimeTokens(candidate, []);
      if (values.length) break;
    }
    const cleaned = values.map((v) => String(v || '').trim()).filter((v) => v && isTimeLikeToken(v));
    const unique = [...new Set(normalizeTimeEntries(cleaned))];
    const allDateLike = unique.length > 0 && unique.every((v) => !Number.isNaN(Date.parse(v)));
    if (allDateLike) unique.sort((a, b) => Date.parse(a) - Date.parse(b));
    return { times: unique, start: unique[0] || '', end: unique[unique.length - 1] || '', raw: unique.join(',') };
  }

  async function fetchLayerTimesteps(wmsBase, layerName) {
    const candidates = [
      `${wmsBase}?request=GetMetadata&item=timesteps&layerName=${encodeURIComponent(layerName)}`,
      `${wmsBase}?request=GetMetadata&item=animationTimesteps&layerName=${encodeURIComponent(layerName)}`
    ];
    for (const url of candidates) {
      try {
        const txt = await fetchText(url);
        if (!txt) continue;
        let values = [];
        try {
          const parsed = JSON.parse(txt);
          values = extractTimeTokens(parsed, []);
        } catch {
          values = txt.split(/[\n,]+/g).map((v) => String(v || '').trim());
        }
        const valid = values.map((v) => v.trim()).filter((v) => v && isTimeLikeToken(v));
        const unique = [...new Set(normalizeTimeEntries(valid))];
        const allDateLike = unique.length > 0 && unique.every((v) => !Number.isNaN(Date.parse(v)));
        if (allDateLike) unique.sort((a, b) => Date.parse(a) - Date.parse(b));
        if (unique.length) return { times: unique, start: unique[0], end: unique[unique.length - 1], raw: unique.join(',') };
      } catch {
        // try next metadata endpoint
      }
    }
    return { times: [], start: '', end: '', raw: '' };
  }

  function parseWmsCapabilities(capsText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(capsText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Failed to parse WMS GetCapabilities XML');

    function inheritedSrs(layerEl) {
      const out = [];
      const seen = new Set();
      let cur = layerEl;
      while (cur) {
        cur.querySelectorAll(':scope > CRS, :scope > SRS').forEach((n) => {
          const value = (n.textContent || '').trim().toUpperCase();
          if (!value || seen.has(value)) return;
          seen.add(value);
          out.push(value);
        });
        const parent = cur.parentElement;
        cur = parent && parent.tagName === 'Layer' ? parent : null;
      }
      return out;
    }

    function inheritedGeoBbox(layerEl) {
      let cur = layerEl;
      while (cur) {
        const bboxEl = cur.querySelector(':scope > EX_GeographicBoundingBox');
        if (bboxEl) {
          const west = parseFloat((bboxEl.querySelector(':scope > westBoundLongitude')?.textContent || '').trim());
          const east = parseFloat((bboxEl.querySelector(':scope > eastBoundLongitude')?.textContent || '').trim());
          const south = parseFloat((bboxEl.querySelector(':scope > southBoundLatitude')?.textContent || '').trim());
          const north = parseFloat((bboxEl.querySelector(':scope > northBoundLatitude')?.textContent || '').trim());
          if ([west, east, south, north].every(Number.isFinite)) return { west, east, south, north };
        }
        const parent = cur.parentElement;
        cur = parent && parent.tagName === 'Layer' ? parent : null;
      }
      return null;
    }

    const layers = [];
    doc.querySelectorAll('Layer Name').forEach((nameNode) => {
      const layerEl = nameNode.closest('Layer');
      if (!layerEl) return;
      const titleEl = layerEl.querySelector(':scope > Title');
      const inheritedTimeEls = [];
      let cur = layerEl;
      while (cur) {
        inheritedTimeEls.push(
          ...Array.from(cur.querySelectorAll(':scope > Dimension, :scope > Extent'))
            .filter((el) => String(el.getAttribute('name') || '').trim().toLowerCase() === 'time')
        );
        const parent = cur.parentElement;
        cur = parent && parent.tagName === 'Layer' ? parent : null;
      }
      const timeEl = inheritedTimeEls[0] || null;
      const srs = inheritedSrs(layerEl);
      const name = (nameNode.textContent || '').trim();
      if (!name) return;
      const title = (titleEl?.textContent || name).trim();
      const rawTime = (timeEl?.textContent || '').trim();
      const time = normalizeTimesFromDimension(rawTime);
      layers.push({ name, title, srs, time, bbox4326: inheritedGeoBbox(layerEl) });
    });

    const seen = new Set();
    return layers.filter((layer) => (seen.has(layer.name) ? false : (seen.add(layer.name), true)));
  }

  return {
    deriveTimesFromLayerDetails,
    fetchLayerTimesteps,
    parseWmsCapabilities
  };
}
