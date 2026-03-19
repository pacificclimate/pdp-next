export function createSubsetDownloadController({
  state,
  portal,
  ui,
  status,
  services,
  time,
  NCSS_WARN_TIMESTEPS,
  logger,
  drawController,
  indexController
}) {
  const {
    subsetSpatialMode,
    subsetTimeStart,
    subsetTimeEnd,
    subsetDownloadBtn
  } = ui;
  const {
    startStatusSpinner,
    stopStatusSpinner,
    setStatus,
    suppressStatusUpdates,
    unsuppressStatusUpdates,
    forceSetStatus
  } = status;
  const {
    fetchText,
    fileServerUrlForUrlPath,
    ncpartitionerBase,
    threddsRoot
  } = services;
  const {
    getSubsetTimeMode,
    getSelectedTime,
    parseSubsetDateValue
  } = time;

  const BACKGROUND_STATUS_TIMEOUT_MS = 120000;
  const BACKGROUND_STATUS_POLL_MS = 1000;
  const SUBSET_DOWNLOAD_LABEL = 'Download subset';

  let activeBackgroundStatus = null;

  function setSubsetDownloadBusy(isBusy) {
    subsetDownloadBtn.disabled = isBusy;
    subsetDownloadBtn.textContent = isBusy ? `${SUBSET_DOWNLOAD_LABEL}...` : SUBSET_DOWNLOAD_LABEL;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearBackgroundSubsetStatus(message = '', isError = false) {
    if (activeBackgroundStatus?.timer) {
      clearInterval(activeBackgroundStatus.timer);
    }
    activeBackgroundStatus = null;
    setSubsetDownloadBusy(false);
    if (message) setStatus(message, isError);
  }

  function startBackgroundSubsetStatus(runId) {
    clearBackgroundSubsetStatus();
    setStatus('Subset submitted. Waiting for server... (0s)');
    suppressStatusUpdates();
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!activeBackgroundStatus || activeBackgroundStatus.runId !== runId) {
        clearInterval(timer);
        return;
      }
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      if ((Date.now() - startedAt) >= BACKGROUND_STATUS_TIMEOUT_MS) {
        clearInterval(timer);
        activeBackgroundStatus = null;
        unsuppressStatusUpdates();
        setSubsetDownloadBusy(false);
        setStatus('Subset is still processing in the background. Check browser downloads; server confirmation may lag.');
        return;
      }
      forceSetStatus(`Subset submitted. Waiting for server... (${elapsedSeconds}s)`);
    }, BACKGROUND_STATUS_POLL_MS);
    activeBackgroundStatus = { runId, timer };
    // Return a stop function the async artifact-watcher can always call,
    // regardless of whether activeBackgroundStatus has been replaced by a later run.
    return () => {
      clearInterval(timer);
      if (activeBackgroundStatus?.runId === runId) activeBackgroundStatus = null;
      unsuppressStatusUpdates();
      setSubsetDownloadBusy(false);
    };
  }

  function cancelPendingSubsetStatus() {
    unsuppressStatusUpdates();
    clearBackgroundSubsetStatus();
    stopStatusSpinner();
  }

  function triggerBackgroundDownload(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function bboxContains(outer, inner, tolerance = 1e-6) {
    if (!outer || !inner) return false;
    return outer.west <= (inner.west + tolerance)
      && outer.south <= (inner.south + tolerance)
      && outer.east >= (inner.east - tolerance)
      && outer.north >= (inner.north - tolerance);
  }

  async function findOutputArtifactByBasename(basename, startUnixSec) {
    const catalogUrl = `${threddsRoot()}catalog/output/catalog.xml?_ts=${Date.now()}`;
    const xmlText = await fetchText(catalogUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return null;
    let best = null;
    doc.querySelectorAll('dataset[urlPath]').forEach((ds) => {
      const name = String(ds.getAttribute('name') || '');
      const urlPath = String(ds.getAttribute('urlPath') || '');
      if (!name.startsWith(`${basename}_`)) return;
      const match = name.match(/_(\d+)\.(nc|nc4)$/i);
      if (!match) return;
      const ts = Number(match[1]);
      if (!Number.isFinite(ts) || ts < (startUnixSec - 2)) return;
      if (!best || ts > best.ts) best = { ts, name, urlPath };
    });
    return best;
  }

  async function waitForOutputArtifact({ basename, startUnixSec, timeoutMs = 3600000, pollMs = 2000 }) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
      try {
        const hit = await findOutputArtifactByBasename(basename, startUnixSec);
        if (hit) return hit;
      } catch { /* artifact not yet in catalog — keep polling */ }
      await sleep(pollMs);
    }
    throw new Error('Timed out waiting for output artifact');
  }

  async function downloadSubset() {
    if (subsetDownloadBtn.disabled) return;
    cancelPendingSubsetStatus();
    if (!state.currentDataset) return alert('Please select a dataset first');
    if (!state.variable) return alert('Could not infer variable for this file.');
    setSubsetDownloadBusy(true);
    const run = logger.startSubsetRun('subset-download', { portal: portal.id, dataset: state.currentDataset?.urlPath || null });
    const spatialMode = (subsetSpatialMode?.value || 'viewport').toLowerCase();
    const datasetBbox = state.selectedLayer?.bbox4326 || { west: -180, south: -90, east: 180, north: 90 };
    let bbox = null;
    let useWholeSpatialDomain = spatialMode === 'whole';
    if (spatialMode === 'whole') {
      bbox = datasetBbox;
    } else if (spatialMode === 'draw_bbox' || spatialMode === 'draw_point') {
      bbox = drawController.getDrawnBbox4326();
      if (!bbox) {
        setSubsetDownloadBusy(false);
        alert(spatialMode === 'draw_point' ? 'Please add a point on the map first.' : 'Please draw a geometry on the map first.');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-drawn-bbox' });
        return;
      }
    } else {
      bbox = drawController.getCurrentViewBbox4326();
      useWholeSpatialDomain = bboxContains(bbox, datasetBbox);
      if (useWholeSpatialDomain) bbox = datasetBbox;
    }
    if (!bbox) {
      setSubsetDownloadBusy(false);
      alert('Could not determine map extent for bbox.');
      logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-bbox' });
      return;
    }

    const subsetTimeMode = getSubsetTimeMode();
    const useFull = subsetTimeMode === 'full';
    const useCurrent = subsetTimeMode === 'current';
    let rangeStart = '';
    let rangeEnd = '';
    if (useCurrent) {
      const selectedTime = getSelectedTime();
      if (!selectedTime || selectedTime === '—') {
        setSubsetDownloadBusy(false);
        alert('No selected time available for this dataset.');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-selected-time' });
        return;
      }
    } else if (useFull) {
      rangeStart = state.selectedLayer?.time?.start || state.times?.[0] || '';
      rangeEnd = state.selectedLayer?.time?.end || state.times?.[state.times.length - 1] || '';
      if (state.times.length > NCSS_WARN_TIMESTEPS) {
        const proceed = window.confirm(`Full-range subset will request ${state.times.length} timesteps and may time out. Continue?`);
        if (!proceed) {
          setSubsetDownloadBusy(false);
          logger.finishSubsetRun(run, 'cancelled', { reason: 'user-cancelled-full-time-warning' });
          return;
        }
      }
    } else {
      const startIso = parseSubsetDateValue(subsetTimeStart.value, 'start');
      const endIso = parseSubsetDateValue(subsetTimeEnd.value, 'end');
      if (startIso === null || endIso === null) {
        setSubsetDownloadBusy(false);
        alert('Please enter dates as YYYY, YYYY-MM, YYYY-MM-DD (or with / separators).');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'invalid-date-input' });
        return;
      }
      rangeStart = startIso || '';
      rangeEnd = endIso || '';
      if (rangeStart && rangeEnd && Date.parse(rangeStart) > Date.parse(rangeEnd)) {
        setSubsetDownloadBusy(false);
        alert('Start date must be before end date.');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'invalid-date-range' });
        return;
      }
    }

    try {
      if (useWholeSpatialDomain && useFull) {
        const fullFileUrl = fileServerUrlForUrlPath(state.currentDataset.urlPath);
        const perfStart = Date.now();
        startStatusSpinner('Starting full-file download (HTTPServer)…');
        triggerBackgroundDownload(fullFileUrl);
        stopStatusSpinner('Full-file download started.');
        setSubsetDownloadBusy(false);
        try {
          const head = await fetch(`${fullFileUrl}?_ts=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
          const bytes = Number(head.headers.get('content-length') || 0);
          const elapsedMs = Date.now() - perfStart;
          logger.logSubsetPerf({
            mode: 'httpserver-full-file',
            file: state.currentDataset.urlPath,
            elapsedMs,
            bytes,
            bytesPerSec: (bytes > 0 && elapsedMs > 0) ? (bytes / (elapsedMs / 1000)) : null,
            at: new Date().toISOString()
          });
        } catch { /* perf logging is best-effort — don't let it block the download */ }
        logger.finishSubsetRun(run, 'ok', { route: 'httpserver-full-file', spatialMode, timeMode: 'full', file: state.currentDataset.urlPath });
        return;
      }

      const tIndexStart = performance.now();
      startStatusSpinner('Converting bounds/time to ncpartitioner indexes…');
      const indexInfo = await indexController.getNcpartitionerIndexInfo(state.currentDataset.urlPath);
      const [latStart, latEnd] = useWholeSpatialDomain
        ? [0, Math.max(0, indexInfo.lat.length - 1)]
        : indexController.findBoundedIndexRange(indexInfo.lat, bbox.south, bbox.north);
      const [lonStart, lonEnd] = useWholeSpatialDomain
        ? [0, Math.max(0, indexInfo.lon.length - 1)]
        : indexController.findBoundedIndexRange(indexInfo.lon, bbox.west, bbox.east);
      const tIndexEnd = performance.now();

      let timeStartIso = '';
      let timeEndIso = '';
      if (useCurrent) {
        const selectedTime = getSelectedTime();
        timeStartIso = selectedTime;
        timeEndIso = selectedTime;
      } else if (rangeStart || rangeEnd) {
        timeStartIso = rangeStart || state.times?.[0] || '';
        timeEndIso = rangeEnd || state.times?.[state.times.length - 1] || timeStartIso;
      } else {
        timeStartIso = state.times?.[0] || '';
        timeEndIso = state.times?.[state.times.length - 1] || timeStartIso;
      }

      const [timeStart, timeEnd] = indexController.findTimeIndexRange(state.times || [], timeStartIso, timeEndIso);
      const targets = [
        `time[${timeStart}:${timeEnd}]`,
        `lat[${latStart}:${latEnd}]`,
        `lon[${lonStart}:${lonEnd}]`,
        `${state.variable}[${timeStart}:${timeEnd}][${latStart}:${latEnd}][${lonStart}:${lonEnd}]`
      ].join(',');
      const filepath = `${state.currentDataset.urlPath}.nc`;
      const partitionParams = new URLSearchParams();
      partitionParams.set('filepath', filepath);
      partitionParams.set('targets', targets);
      const partitionUrl = `${ncpartitionerBase()}?${partitionParams.toString()}`;
      const tPartitionStart = performance.now();
      startStatusSpinner('Building subset with ncpartitioner…');
      const startUnixSec = Math.floor(Date.now() / 1000);
      const outputBaseName = state.currentDataset.urlPath.replace(/^.*\//, '').replace(/\.(nc|nc4)$/i, '');
      triggerBackgroundDownload(partitionUrl);
      stopStatusSpinner();
      const stopBackgroundStatus = startBackgroundSubsetStatus(run.id);
      logger.finishSubsetRun(run, 'ok', {
        route: 'ncpartitioner',
        spatialMode,
        timeMode: useCurrent ? 'current' : (useFull ? 'full' : 'range'),
        indexMs: Math.round(tIndexEnd - tIndexStart),
        file: state.currentDataset.urlPath
      });
      void (async () => {
        try {
          const artifact = await waitForOutputArtifact({
            basename: outputBaseName,
            startUnixSec,
            timeoutMs: BACKGROUND_STATUS_TIMEOUT_MS
          });
          const downloadUrl = `${threddsRoot()}fileServer/${artifact.urlPath}`;
          const head = await fetch(`${downloadUrl}?_ts=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
          const bytes = Number(head.headers.get('content-length') || 0);
          const tPartitionEnd = performance.now();
          stopBackgroundStatus();
          setStatus('Generation complete, starting download');
          logger.logSubsetPerf({
            mode: 'ncpartitioner',
            file: state.currentDataset.urlPath,
            output: artifact.name,
            elapsedMs: Math.round(tPartitionEnd - tPartitionStart),
            bytes,
            bytesPerSec: (bytes > 0 && (tPartitionEnd - tPartitionStart) > 0) ? (bytes / ((tPartitionEnd - tPartitionStart) / 1000)) : null,
            spatialMode,
            timeMode: useCurrent ? 'current' : (useFull ? 'full' : 'range'),
            at: new Date().toISOString()
          });
        } catch (artifactError) {
          stopBackgroundStatus();
          setStatus('Subset is still processing in the background. Check browser downloads; server confirmation may lag.');
          console.warn('Could not verify ncpartitioner output artifact:', artifactError);
        }
      })();
      return;
    } catch (error) {
      console.error(error);
      cancelPendingSubsetStatus();
      stopStatusSpinner(`Subset failed: ${error?.message || error}`, true);
      logger.finishSubsetRun(run, 'error', {
        route: 'ncpartitioner',
        spatialMode,
        timeMode: useCurrent ? 'current' : (useFull ? 'full' : 'range'),
        error: String(error?.message || error || 'unknown')
      });
      alert(`Subset failed: ${error?.message || error}`);
    } finally {
      if (!activeBackgroundStatus) setSubsetDownloadBusy(false);
    }
  }

  return {
    downloadSubset,
    cancelPendingSubsetStatus
  };
}
