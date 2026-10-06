// OpenLayers transforms vertices, not edges. Reuse the existing 16 samples per
// edge, in the defining CRS, so projected parallels follow their curved path.
export function bboxDisplayGeometry(olRef, extent, sourceCrs, targetCrs) {
  const corners = bboxCorners(extent);
  const ring = [];
  corners.forEach((start, index) => {
    const end = corners[(index + 1) % 4];
    for (let step = 0; step < 16; step += 1) {
      ring.push(start.map((value, axis) => value + (end[axis] - value) * step / 16));
    }
  });
  ring.push([...corners[0]]);
  return new olRef.geom.Polygon([ring]).transform(sourceCrs, targetCrs);
}

export function bboxCorners([minX, minY, maxX, maxY]) {
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

export function parseBboxInput(values) {
  const extent = values.map((value) => String(value).trim() === '' ? NaN : Number(value));
  if (!extent.every(Number.isFinite)) return { error: 'Enter four finite numbers.' };
  if (extent[0] >= extent[2]) return { error: 'Min X must be less than Max X.' };
  if (extent[1] >= extent[3]) return { error: 'Min Y must be less than Max Y.' };
  return { extent };
}

export function reprojectSubsetFeatures(olRef, source, previousCrs, nextCrs) {
  source.getFeatures().forEach((feature) => {
    const geometry = feature.getGeometry();
    if (!geometry) return;
    let original = feature.get('selectionGeometry');
    let crs = feature.get('selectionCrs');
    if (!original?.clone || !crs) {
      original = geometry.clone();
      crs = previousCrs;
      feature.set('selectionGeometry', original.clone(), true);
      feature.set('selectionCrs', crs, true);
    }
    feature.setGeometry(original.getType() === 'Polygon'
      ? bboxDisplayGeometry(olRef, original.getExtent(), crs, nextCrs)
      : original.clone().transform(crs, nextCrs));
  });
}
