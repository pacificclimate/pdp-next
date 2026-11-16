import { formatCellValue, parseCellValue } from './cell-value.js';

export function formatCoordinatePair(coordinate, crs) {
  if (!coordinate?.every(Number.isFinite)) return '';
  const geographic = crs === 'EPSG:4326' || crs === 'CRS:84';
  const axes = geographic ? ['Lon', 'Lat'] : ['X', 'Y'];
  return coordinate.map((value, index) => {
    const rounded = Number(value.toFixed(geographic ? 5 : 0));
    const text = geographic ? rounded.toFixed(5) : rounded.toLocaleString('en-US');
    return `${axes[index]}: ${text}`;
  }).join(' · ');
}

export function installPointerCoordinates(map, element, getCurrentCrs, {
  getCellValueRequest = null, fetchRef = fetch, delay = 250,
} = {}) {
  let coordinate = null;
  let coordinateText = '';
  let timer = null;
  let controller = null;
  let generation = 0;

  function render(suffix = '') {
    const text = coordinateText + (suffix ? ` · ${suffix}` : '');
    if (element.textContent !== text) element.textContent = text;
    element.hidden = !text;
  }
  function cancel() {
    generation += 1;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }
  function clear() {
    cancel();
    coordinate = null;
    coordinateText = '';
    render();
  }
  function refresh(query = true) {
    cancel();
    render();
    if (!coordinate || !query || !getCellValueRequest) return;
    const pendingGeneration = generation;
    timer = window.setTimeout(async () => {
      timer = null;
      const request = getCellValueRequest(coordinate);
      if (!request) return;
      controller = new AbortController();
      const signal = controller.signal;
      render(`${request.label ? `${request.label} cell` : 'Cell'}: …`);
      try {
        const response = await fetchRef(request.url, { signal });
        if (!response.ok) throw new Error('Cell-value request failed.');
        const value = parseCellValue(await response.text());
        if (generation !== pendingGeneration) return;
        if (getCellValueRequest(coordinate)?.url !== request.url) { render(); return; }
        render(formatCellValue(value, request.label, request.units));
      } catch {
        if (generation !== pendingGeneration || signal.aborted) return;
        if (getCellValueRequest(coordinate)?.url !== request.url) { render(); return; }
        render('Cell value unavailable');
      }
    }, delay);
  }
  map.on('pointermove', (event) => {
    const crs = getCurrentCrs();
    const pair = formatCoordinatePair(event.coordinate, crs);
    coordinate = pair ? [...event.coordinate] : null;
    coordinateText = pair ? `${crs} · ${pair}` : '';
    refresh(!event.dragging);
  });
  map.getViewport().addEventListener('pointerleave', clear);
  map.on('change:view', clear);
  map.on('movestart', clear);
  return { refresh };
}
