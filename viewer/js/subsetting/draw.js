export function createSubsetDrawController({
  map,
  olRef,
  subsetDrawSource,
  subsetDrawLayer,
  setStatus,
  getCurrentCrs
}) {
  let subsetDrawInteraction = null;
  const EDGE_SEGMENTS = 16;

  function densifyPolygon(geometry) {
    if (geometry.getType() !== 'Polygon') return geometry.clone();
    const rings = geometry.getCoordinates().map((ring) => {
      const denseRing = [];
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index];
        const end = ring[index + 1];
        for (let step = 0; step < EDGE_SEGMENTS; step += 1) {
          const fraction = step / EDGE_SEGMENTS;
          denseRing.push([
            start[0] + ((end[0] - start[0]) * fraction),
            start[1] + ((end[1] - start[1]) * fraction)
          ]);
        }
      }
      denseRing.push([...ring[ring.length - 1]]);
      return denseRing;
    });
    return new olRef.geom.Polygon(rings);
  }

  function rememberOriginalGeometry(feature) {
    const geometry = feature?.getGeometry();
    if (!geometry) return;
    const originalGeometry = densifyPolygon(geometry);
    feature.setGeometry(originalGeometry);
    feature.set('selectionGeometry', originalGeometry.clone(), true);
    feature.set('selectionCrs', getCurrentCrs(), true);
  }

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
    subsetDrawInteraction.on('drawend', (event) => {
      rememberOriginalGeometry(event.feature);
      setStatus('Drawing captured for subset.');
    });
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
    const originalGeometry = feature.get('selectionGeometry');
    const originalCrs = feature.get('selectionCrs');
    const ll = originalGeometry?.clone && originalCrs
      ? originalGeometry.clone().transform(originalCrs, 'EPSG:4326').getExtent()
      : olRef.proj.transformExtent(
        geometry.getExtent(),
        getCurrentCrs(),
        'EPSG:4326',
        8
      );
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
