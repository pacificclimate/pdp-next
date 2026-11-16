import { formatCoordinatePair } from '../map/coordinates.js';
import { validSelection } from './selection.js';
import { bboxCorners, bboxDisplayGeometry, parseBboxInput } from './bbox.js';

export function createSubsetDrawController({
  map, olRef, subsetDrawSource, subsetDrawLayer, setStatus, getCurrentCrs, ui
}) {
  let subsetDrawInteraction = null;
  let mode = null;
  let sketch = null;
  let sketchOriginal = null;
  let lastSyncedGeometry = null;
  let lastSyncedCoordinates = [];
  let editorCrs = getCurrentCrs();
  ui.bboxEditCrs.value = editorCrs;
  let drag = null;
  let lastPointerEvent = null;
  let previousCursor = null;
  const viewport = map.getViewport();
  const sourceCrs = 'EPSG:4326'; // Subset indexes are the data's lon/lat coordinates.
  const fields = [ui.bboxMinX, ui.bboxMinY, ui.bboxMaxX, ui.bboxMaxY];
  const positions = ['top-right', 'top-left', 'bottom-left', 'bottom-right'];
  const labels = positions.map((positioning, index) => {
    const element = document.createElement('span');
    element.className = 'bbox-corner-label';
    const overlay = new olRef.Overlay({
      element, positioning, offset: [index === 0 || index === 3 ? -9 : 9, index < 2 ? 9 : -9],
      stopEvent: false,
    });
    map.addOverlay(overlay);
    return overlay;
  });

  function currentFeature() { return sketch || subsetDrawSource.getFeatures()[0]; }
  function geographicEditor() { return editorCrs === 'EPSG:4326' || editorCrs === 'CRS:84'; }
  function roundCoordinates(coordinates, crs) {
    const decimals = crs === 'EPSG:4326' || crs === 'CRS:84' ? 5 : 0;
    return coordinates.map((value) => Number(value.toFixed(decimals)));
  }

  function setSelectionCursor(cursor = '') {
    if (cursor) {
      if (previousCursor === null) previousCursor = viewport.style.cursor || '';
      viewport.style.cursor = cursor;
    } else if (previousCursor !== null) {
      viewport.style.cursor = previousCursor;
      previousCursor = null;
    }
  }

  function handleIndex(original, crs, event) {
    const corners = original.getType() === 'Point' ? [original.getCoordinates()] : bboxCorners(original.getExtent());
    return corners.findIndex((corner) => {
      const pixel = map.getPixelFromCoordinate(olRef.proj.transform(corner, crs, getCurrentCrs()));
      return Math.hypot(pixel[0] - event.pixel[0], pixel[1] - event.pixel[1]) <= 10;
    });
  }

  function updateSelectionCursor(event = lastPointerEvent) {
    const feature = currentFeature();
    const original = feature?.get('selectionGeometry');
    const isBbox = mode === 'draw_bbox' && original?.getType() === 'Polygon';
    const movable = !sketch && (isBbox || (mode === 'draw_point' && original?.getType() === 'Point'));
    const index = movable && event?.pixel ? handleIndex(original, feature.get('selectionCrs'), event) : -1;
    const resizeIndex = isBbox && drag ? drag.index : index;
    let cursor = '';
    if (movable && isBbox && resizeIndex >= 0) {
      const corners = bboxCorners(original.getExtent());
      const pixels = [corners[resizeIndex], corners[(resizeIndex + 2) % 4]].map((corner) =>
        map.getPixelFromCoordinate(olRef.proj.transform(corner, feature.get('selectionCrs'), getCurrentCrs())));
      cursor = (pixels[0][0] - pixels[1][0]) * (pixels[0][1] - pixels[1][1]) >= 0
        ? 'nwse-resize' : 'nesw-resize';
    } else if (movable && drag) cursor = 'grabbing';
    else if (movable && (index >= 0 || (isBbox && event?.coordinate
      && feature.getGeometry().intersectsCoordinate(event.coordinate)))) cursor = 'grab';
    setSelectionCursor(cursor);
  }

  map.on('pointermove', (event) => { lastPointerEvent = event; updateSelectionCursor(event); });
  viewport.addEventListener('pointerleave', () => { lastPointerEvent = null; setSelectionCursor(); });
  function sync() {
    updateSelectionCursor();
    const feature = currentFeature();
    const original = feature?.get('selectionGeometry');
    const crs = feature?.get('selectionCrs');
    const isBbox = mode === 'draw_bbox' && original?.getType() === 'Polygon';
    const isPoint = mode === 'draw_point' && original?.getType() === 'Point';
    const editable = isBbox || isPoint;
    ui.bboxEditor.hidden = !editable;
    const geographic = geographicEditor();
    ui.bboxMinXLabel.textContent = isPoint ? (geographic ? 'Longitude' : 'X (m)')
      : geographic ? 'Min longitude' : 'Southwest X (m)';
    ui.bboxMinYLabel.textContent = isPoint ? (geographic ? 'Latitude' : 'Y (m)')
      : geographic ? 'Min latitude' : 'Southwest Y (m)';
    ui.bboxMaxXLabel.textContent = geographic ? 'Max longitude' : 'Northeast X (m)';
    ui.bboxMaxYLabel.textContent = geographic ? 'Max latitude' : 'Northeast Y (m)';
    ui.bboxMaxXField.hidden = isPoint;
    ui.bboxMaxYField.hidden = isPoint;
    ui.bboxShowLabel.textContent = isPoint ? 'Show point coordinates' : 'Show bbox coordinates';
    ui.bboxHint.textContent = isPoint ? 'Drag the point to move.'
      : `${geographic ? '' : 'Edit the southwest and northeast corners; the selection stays a lon/lat rectangle. '}`
        + 'Drag a corner to resize; drag inside to move.';
    if (editable && original !== lastSyncedGeometry) {
      lastSyncedGeometry = original;
      const coordinates = roundCoordinates(isPoint
        ? olRef.proj.transform(original.getCoordinates(), crs, editorCrs)
        : [original.getExtent().slice(0, 2), original.getExtent().slice(2)]
          .flatMap((corner) => olRef.proj.transform(corner, crs, editorCrs)), editorCrs);
      fields.forEach((field, index) => { field.value = coordinates[index] === undefined ? '' : String(coordinates[index]); });
      lastSyncedCoordinates = coordinates;
      showInputError();
    }
    if (editable) {
      const extent = roundCoordinates(original.clone().transform(crs, sourceCrs).getExtent(), sourceCrs);
      ui.bboxCrs.textContent = sourceCrs;
      ui.bboxSummary.textContent = isPoint
        ? `Lon: ${extent[0]} · Lat: ${extent[1]}`
        : `Lon: ${extent[0]} to ${extent[2]} · Lat: ${extent[1]} to ${extent[3]}`;
    }
    if (!editable) lastSyncedGeometry = null;
    labels.forEach((overlay, index) => {
      if (!editable || !ui.bboxShowCoordinates.checked || (isPoint && index > 0)) {
        overlay.setPosition(undefined); return;
      }
      const corner = isPoint ? original.getCoordinates() : bboxCorners(original.getExtent())[index];
      const projected = olRef.proj.transform(corner, crs, getCurrentCrs());
      overlay.getElement().textContent = `${getCurrentCrs()} · ${formatCoordinatePair(projected, getCurrentCrs())}`;
      overlay.setPosition(projected);
    });
  }

  function setBbox(feature, extent, crs) {
    extent = roundCoordinates(extent, crs);
    if (parseBboxInput(extent).error) return;
    const corners = bboxCorners(extent);
    const original = new olRef.geom.Polygon([[...corners, [...corners[0]]]]);
    feature.set('selectionGeometry', original, true);
    feature.set('selectionCrs', crs, true);
    feature.setGeometry(bboxDisplayGeometry(olRef, extent, crs, getCurrentCrs()));
    sync();
  }

  function setPoint(feature, coordinates, crs) {
    coordinates = roundCoordinates(coordinates, crs);
    const original = new olRef.geom.Point(coordinates);
    feature.set('selectionGeometry', original, true);
    feature.set('selectionCrs', crs, true);
    feature.setGeometry(original.clone().transform(crs, getCurrentCrs()));
    sync();
  }

  function coordinateBoundsError(coordinates, crs) {
    const bounds = olRef.proj.get(crs)?.getExtent();
    if (!bounds) return null;
    for (let axis = 0; axis < 2; axis += 1) {
      if (coordinates.some((value, index) => index % 2 === axis
        && (value < bounds[axis] || value > bounds[axis + 2]))) {
        return `${axis === 0 ? 'X' : 'Y'} must be between ${bounds[axis]} and ${bounds[axis + 2]} in ${crs}.`;
      }
    }
    return null;
  }

  function showInputError(error = '') {
    ui.bboxError.textContent = error;
    fields.forEach((field) => field.setAttribute('aria-invalid', String(!!error)));
  }

  function apply() {
    const feature = currentFeature();
    if (sketch || !feature || (mode !== 'draw_bbox' && mode !== 'draw_point')) return;
    const isPoint = mode === 'draw_point';
    const values = fields.slice(0, isPoint ? 2 : 4).map((field) => field.value);
    const input = values.map((value) => value.trim() === '' ? NaN : Number(value));
    let error = input.every(Number.isFinite) ? null
      : isPoint ? 'Enter two finite numbers.' : 'Enter four finite numbers.';
    const roundedInput = roundCoordinates(input, editorCrs);
    if (!error && input.some((value, index) => value !== roundedInput[index])) {
      error = geographicEditor() ? 'Use at most 5 decimal places.' : 'Use whole metres.';
    }
    error ||= coordinateBoundsError(input, editorCrs);
    showInputError(error || '');
    if (error) return;

    // Unchanged fields must not round-trip through a projection again.
    if (input.length === lastSyncedCoordinates.length
      && input.every((value, index) => value === lastSyncedCoordinates[index])) return;

    const canonicalCrs = isPoint ? feature.get('selectionCrs') : sourceCrs;
    // Convert corner points, not a projected Min/Max extent. Avoid round-trip
    // drift in untouched corners.
    const coordinates = roundCoordinates(isPoint ? olRef.proj.transform(input, editorCrs, canonicalCrs)
      : [input.slice(0, 2), input.slice(2)].flatMap((corner, index) => {
        const offset = index * 2;
        if (feature.get('selectionCrs') === canonicalCrs
          && corner.every((value, axis) => value === lastSyncedCoordinates[offset + axis])) {
          return feature.get('selectionGeometry').getExtent().slice(offset, offset + 2);
        }
        return olRef.proj.transform(corner, editorCrs, canonicalCrs);
      }), canonicalCrs);
    const lonlat = isPoint ? olRef.proj.transform(coordinates, canonicalCrs, sourceCrs) : coordinates;
    error = lonlat.every(Number.isFinite) ? coordinateBoundsError(lonlat, sourceCrs)
      : 'Coordinates cannot be transformed to EPSG:4326.';
    if (canonicalCrs !== sourceCrs) error ||= coordinateBoundsError(coordinates, canonicalCrs);
    if (!error && !isPoint) {
      error = parseBboxInput(coordinates).error;
      if (error && !geographicEditor()) error = 'Check the corner order: southwest first, northeast second.';
    }
    showInputError(error || '');
    if (error) return;

    const update = isPoint ? setPoint : setBbox;
    update(feature, coordinates, canonicalCrs);
  }
  ui.bboxApply.addEventListener('click', apply);
  ui.bboxEditCrs.addEventListener('change', () => {
    if (!olRef.proj.get(ui.bboxEditCrs.value)) { ui.bboxEditCrs.value = editorCrs; return; }
    editorCrs = ui.bboxEditCrs.value;
    lastSyncedGeometry = null;
    sync();
  });
  fields.forEach((field) => field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); apply(); }
  }));
  ui.bboxShowCoordinates.addEventListener('change', sync);
  ['addfeature', 'changefeature', 'clear', 'removefeature'].forEach((event) => subsetDrawSource.on(event, sync));
  map.on('change:view', () => {
    drag = null;
    lastPointerEvent = null;
    setSelectionCursor();
    subsetDrawInteraction?.abortDrawing();
    sync();
  });

  // Corner handles and movement stay in the defining coordinate space. A
  // generic Modify on the projected, sampled polygon would distort the bbox.
  const handleStyle = new olRef.style.Style({ image: new olRef.style.Circle({
    radius: 5, fill: new olRef.style.Fill({ color: 'white' }),
    stroke: new olRef.style.Stroke({ color: '#3399CC', width: 2 }),
  }) });
  const defaultStyle = subsetDrawLayer.getStyleFunction();
  subsetDrawLayer.setStyle((feature, resolution) => {
    const styles = defaultStyle(feature, resolution);
    const original = feature.get('selectionGeometry');
    if (mode !== 'draw_bbox' || original?.getType() !== 'Polygon') return styles;
    return [...styles, ...bboxCorners(original.getExtent()).map((corner) => {
      const style = handleStyle.clone();
      style.setGeometry(new olRef.geom.Point(olRef.proj.transform(corner, feature.get('selectionCrs'), getCurrentCrs())));
      return style;
    })];
  });
  const editInteraction = new olRef.interaction.Pointer({
    handleDownEvent(event) {
      const feature = currentFeature();
      if ((mode !== 'draw_bbox' && mode !== 'draw_point') || sketch || !feature || event.originalEvent.button !== 0) return false;
      const original = feature.get('selectionGeometry');
      const isPoint = mode === 'draw_point' && original?.getType() === 'Point';
      if (!isPoint && original?.getType() !== 'Polygon') return false;
      const crs = feature.get('selectionCrs');
      const extent = original.getExtent();
      const index = handleIndex(original, crs, event);
      if (index < 0 && (isPoint || !feature.getGeometry().intersectsCoordinate(event.coordinate))) return false;
      drag = { feature, crs, extent: [...extent], index, isPoint,
        start: olRef.proj.transform(event.coordinate, getCurrentCrs(), crs) };
      lastPointerEvent = event;
      updateSelectionCursor(event);
      return true;
    },
    handleDragEvent(event) {
      const point = olRef.proj.transform(event.coordinate, getCurrentCrs(), drag.crs);
      if (drag.isPoint) {
        setPoint(drag.feature, drag.extent.slice(0, 2).map((value, axis) =>
          value + point[axis] - drag.start[axis]), drag.crs);
        return;
      }
      let extent;
      if (drag.index < 0) {
        extent = drag.extent.map((value, axis) => value + point[axis % 2] - drag.start[axis % 2]);
      } else {
        const opposite = bboxCorners(drag.extent)[(drag.index + 2) % 4];
        extent = [Math.min(point[0], opposite[0]), Math.min(point[1], opposite[1]),
          Math.max(point[0], opposite[0]), Math.max(point[1], opposite[1])];
      }
      if (extent[0] < extent[2] && extent[1] < extent[3]) setBbox(drag.feature, extent, drag.crs);
    },
    handleUpEvent(event) {
      drag = null;
      if (event) lastPointerEvent = event;
      updateSelectionCursor();
      return false;
    },
  });

  function clearSubsetDrawing() { drag = null; subsetDrawSource.clear(); sync(); }

  function setSubsetDrawMode(nextMode) {
    drag = null;
    setSelectionCursor();
    subsetDrawInteraction?.abortDrawing();
    if (subsetDrawInteraction) map.removeInteraction(subsetDrawInteraction);
    map.removeInteraction(editInteraction);
    subsetDrawInteraction = null;
    mode = nextMode;
    subsetDrawLayer.setVisible(mode === 'draw_bbox' || mode === 'draw_point');
    subsetDrawLayer.changed();
    sync();
    if (mode !== 'draw_bbox' && mode !== 'draw_point') return;
    subsetDrawInteraction = new olRef.interaction.Draw({
      source: subsetDrawSource,
      type: mode === 'draw_point' ? 'Point' : 'Circle',
      ...(mode === 'draw_bbox' ? { geometryFunction(coordinates, geometry) {
        const corners = [coordinates[0], coordinates[coordinates.length - 1]]
          .map((corner) => olRef.proj.transform(corner, getCurrentCrs(), sourceCrs));
        const extent = roundCoordinates([Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]),
          Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])], sourceCrs);
        const ring = bboxCorners(extent);
        sketchOriginal = new olRef.geom.Polygon([[...ring, [...ring[0]]]]);
        const display = bboxDisplayGeometry(olRef, extent, sourceCrs, getCurrentCrs());
        if (!geometry) geometry = display;
        else geometry.setCoordinates(display.getCoordinates());
        if (sketch) {
          sketch.set('selectionGeometry', sketchOriginal, true);
          sync();
        }
        return geometry;
      } } : {}),
    });
    subsetDrawInteraction.on('drawstart', (event) => {
      subsetDrawSource.clear();
      editorCrs = getCurrentCrs();
      ui.bboxEditCrs.value = editorCrs;
      lastSyncedGeometry = null;
      sketch = event.feature;
      if (mode === 'draw_bbox') {
        sketch.set('selectionGeometry', sketchOriginal, true);
        sketch.set('selectionCrs', sourceCrs, true);
      }
      sync();
    });
    subsetDrawInteraction.on('drawabort', () => { sketch = null; sketchOriginal = null; sync(); });
    subsetDrawInteraction.on('drawend', (event) => {
      // Circle geometryFunction already produced the final polygon. Do not
      // rebuild on release: the stored source extent and live sketch agree.
      if (mode === 'draw_point') {
        setPoint(event.feature, event.feature.getGeometry().getCoordinates(), getCurrentCrs());
      }
      sketch = null;
      sketchOriginal = null;
      setStatus('Drawing captured for subset.');
    });
    map.addInteraction(subsetDrawInteraction);
    map.addInteraction(editInteraction);
  }

  function restoreSelection(selection) {
    if (!validSelection(selection) || !olRef.proj.get(selection.crs)) return false;
    if (coordinateBoundsError(selection.coordinates, selection.crs)) return false;
    if (selection.type === 'bbox' && parseBboxInput(roundCoordinates(selection.coordinates, selection.crs)).error) return false;
    setSubsetDrawMode(selection.type === 'bbox' ? 'draw_bbox' : 'draw_point');
    clearSubsetDrawing();
    const feature = new olRef.Feature();
    const update = selection.type === 'bbox' ? setBbox : setPoint;
    update(feature, selection.coordinates, selection.crs);
    subsetDrawSource.addFeature(feature);
    return true;
  }

  function getCurrentViewBbox4326() {
    const size = map.getSize();
    if (!size) return null;
    const extent = map.getView().calculateExtent(size);
    const [west, south, east, north] = olRef.proj.transformExtent(extent, getCurrentCrs(), 'EPSG:4326');
    return { west, south, east, north };
  }

  function getDrawnBbox4326() {
    const feature = subsetDrawSource.getFeatures()[0];
    if (!feature?.getGeometry()) return null;
    const original = feature.get('selectionGeometry');
    const crs = feature.get('selectionCrs');
    const extent = original?.clone && crs
      ? original.clone().transform(crs, 'EPSG:4326').getExtent()
      : olRef.proj.transformExtent(feature.getGeometry().getExtent(), getCurrentCrs(), 'EPSG:4326', 8);
    const [west, south, east, north] = roundCoordinates(extent, sourceCrs);
    return { west, south, east, north };
  }

  return { restoreSelection, clearSubsetDrawing, setSubsetDrawMode, getCurrentViewBbox4326, getDrawnBbox4326 };
}
