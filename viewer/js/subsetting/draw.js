export function createSubsetDrawController({
  map,
  olRef,
  subsetDrawSource,
  subsetDrawLayer,
  setStatus,
  getCurrentCrs
}) {
  let subsetDrawInteraction = null;

  function clearSubsetDrawing() {
    subsetDrawSource.clear();
  }

  function setSubsetDrawMode(mode) {
    if (subsetDrawInteraction) {
      map.removeInteraction(subsetDrawInteraction);
      subsetDrawInteraction = null;
    }
    subsetDrawLayer.setVisible(mode === 'draw_bbox' || mode === 'draw_point');
    if (mode !== 'draw_bbox' && mode !== 'draw_point') return;
    subsetDrawInteraction = mode === 'draw_point'
      ? new olRef.interaction.Draw({ source: subsetDrawSource, type: 'Point' })
      : new olRef.interaction.Draw({
        source: subsetDrawSource,
        type: 'Circle',
        geometryFunction: olRef.interaction.Draw.createBox()
      });
    subsetDrawInteraction.on('drawstart', () => clearSubsetDrawing());
    subsetDrawInteraction.on('drawend', () => setStatus('Drawing captured for subset.'));
    map.addInteraction(subsetDrawInteraction);
  }

  function getCurrentViewBbox4326() {
    const size = map.getSize();
    if (!size) return null;
    const extent = map.getView().calculateExtent(size);
    const ll = olRef.proj.transformExtent(extent, getCurrentCrs(), 'EPSG:4326');
    const [west, south, east, north] = ll;
    return { west, south, east, north };
  }

  function getDrawnBbox4326() {
    const feature = subsetDrawSource.getFeatures()[0];
    if (!feature) return null;
    const geometry = feature.getGeometry();
    if (!geometry) return null;
    const extent = geometry.getExtent();
    const ll = olRef.proj.transformExtent(extent, getCurrentCrs(), 'EPSG:4326');
    const [west, south, east, north] = ll;
    return { west, south, east, north };
  }

  return {
    clearSubsetDrawing,
    setSubsetDrawMode,
    getCurrentViewBbox4326,
    getDrawnBbox4326
  };
}
