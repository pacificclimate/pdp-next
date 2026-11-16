// Share only canonical coordinates, never the sampled display geometry.
export function validSelection(selection) {
  const count = selection?.type === 'bbox' ? 4 : selection?.type === 'point' ? 2 : 0;
  const coordinates = selection?.coordinates;
  return count > 0 && typeof selection.crs === 'string'
    && /^(?:EPSG:\d+|CRS:84)$/.test(selection.crs)
    && Array.isArray(coordinates) && coordinates.length === count && coordinates.every(Number.isFinite)
    && (count === 2 || (coordinates[0] < coordinates[2] && coordinates[1] < coordinates[3]));
}

export function getDrawnSelection(source, mode) {
  const feature = source.getFeatures()[0];
  const geometry = feature?.get('selectionGeometry');
  const type = mode === 'draw_bbox' && geometry?.getType() === 'Polygon' ? 'bbox'
    : mode === 'draw_point' && geometry?.getType() === 'Point' ? 'point' : null;
  if (!type) return null;
  const selection = { type, crs: feature.get('selectionCrs'),
    coordinates: type === 'bbox' ? geometry.getExtent() : geometry.getCoordinates() };
  return validSelection(selection) ? selection : null;
}

export function readSelectionParams(params) {
  const raw = params.get('selectionCoords');
  if (!raw || raw.split(',').some((value) => value.trim() === '')) return null;
  const selection = { type: params.get('selection'), crs: params.get('selectionCrs'),
    coordinates: raw.split(',').map(Number) };
  return validSelection(selection) ? selection : null;
}

export function writeSelectionParams(params, selection) {
  if (!validSelection(selection)) return;
  params.set('selection', selection.type);
  params.set('selectionCrs', selection.crs);
  params.set('selectionCoords', selection.coordinates.join(','));
}
