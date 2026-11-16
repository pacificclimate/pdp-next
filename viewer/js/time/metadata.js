export function createTimeMetadataController() {

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
      const srs = inheritedSrs(layerEl);
      const name = (nameNode.textContent || '').trim();
      if (!name) return;
      const title = (titleEl?.textContent || name).trim();
      layers.push({ name, title, srs, bbox4326: inheritedGeoBbox(layerEl) });
    });

    const seen = new Set();
    return layers.filter((layer) => (seen.has(layer.name) ? false : (seen.add(layer.name), true)));
  }

  return {
    parseWmsCapabilities
  };
}
