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
    setStatus
  } = status;
  const {
    fileServerUrlForUrlPath,
    ncpartitionerBase
  } = services;
  const {
    getSubsetTimeMode,
    getSelectedTime,
    parseSubsetDateValue
  } = time;

  const BACKGROUND_STATUS_TIMEOUT_MS = 120000;
  const BACKGROUND_STATUS_POLL_MS = 1500;
  const BACKGROUND_STATUS_SLOW_POLL_MS = 10000;
  const FULL_TIME_SUGGESTION_THRESHOLD = 0.6;
  const SUBSET_WAITING_STATUS = 'Subset submitted. Waiting for server...';
  const SUBSET_LONG_WAIT_STATUS = 'Subset processing. Large requests may take several minutes. Waiting for server...';
  const SUBSET_DOWNLOAD_LABEL = 'Download subset';

  const ROUTE = {
    FULL_FILE: 'httpserver-full-file',
    NCPARTITIONER: 'ncpartitioner'
  };

  // Thrown to short-circuit downloadSubset()
  class SubsetCancelled extends Error {}

  let activeBackgroundStatus = null;
  let activeNcPollRunId = null;
  const ncpartitionerPublicRoot = new URL(ncpartitionerBase(), window.location.origin);

  function setSubsetDownloadBusy(isBusy) {
    subsetDownloadBtn.disabled = isBusy;
    subsetDownloadBtn.textContent = isBusy ? `${SUBSET_DOWNLOAD_LABEL}...` : SUBSET_DOWNLOAD_LABEL;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clearBackgroundSubsetStatus(message = '', isError = false) {
    activeBackgroundStatus = null;
    setSubsetDownloadBusy(false);
    if (message) setStatus(message, isError);
  }

  function startBackgroundSubsetStatus(runId) {
    activeBackgroundStatus = null;
    setSubsetDownloadBusy(true);
    activeBackgroundStatus = { runId };
    return () => {
      if (activeBackgroundStatus?.runId === runId) activeBackgroundStatus = null;
      setSubsetDownloadBusy(false);
    };
  }

  function queuePositionFor(payload) {
    const value = payload?.queue_position ?? payload?.queuePosition ?? null;
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function waitingStatusMessage(queuePosition, isLongWait = false) {
    const baseMessage = isLongWait ? SUBSET_LONG_WAIT_STATUS : SUBSET_WAITING_STATUS;
    return queuePosition !== null
      ? `${baseMessage} Queue position: ${queuePosition}.`
      : baseMessage;
  }

  function cancelPendingSubsetStatus() {
    activeNcPollRunId = null;
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

  /**
   * Resolves the spatial extent for the subset based on the UI's spatial mode.
   * Returns { bbox, useWholeSpatialDomain }.
   * Throws SubsetCancelled if the user needs to take an action first (and has
   * already been alerted) or if no extent could be determined.
   */
  function resolveSpatialExtent(spatialMode, run) {
    const datasetBbox = state.selectedLayer?.bbox4326 || { west: -180, south: -90, east: 180, north: 90 };

    if (spatialMode === 'whole') {
      return { bbox: datasetBbox, useWholeSpatialDomain: true };
    }

    if (spatialMode === 'draw_bbox' || spatialMode === 'draw_point') {
      const bbox = drawController.getDrawnBbox4326();
      if (!bbox) {
        alert(spatialMode === 'draw_point' ? 'Please add a point on the map first.' : 'Please draw a geometry on the map first.');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-drawn-bbox' });
        throw new SubsetCancelled();
      }
      return { bbox, useWholeSpatialDomain: false };
    }

    const bbox = drawController.getCurrentViewBbox4326();
    if (!bbox) {
      alert('Could not determine map extent for bbox.');
      logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-bbox' });
      throw new SubsetCancelled();
    }
    const useWholeSpatialDomain = bboxContains(bbox, datasetBbox);
    return { bbox: useWholeSpatialDomain ? datasetBbox : bbox, useWholeSpatialDomain };
  }

  /**
   * Resolves the requested time range based on the UI's time mode.
   * Returns { timeMode, rangeStart, rangeEnd }.
   * Throws SubsetCancelled on invalid/cancelled input (already alerted).
   */
  async function resolveTimeRange(run) {
    const subsetTimeMode = getSubsetTimeMode();
    const useFull = subsetTimeMode === 'full';
    const useCurrent = subsetTimeMode === 'current';
    const timeMode = useCurrent ? 'current' : (useFull ? 'full' : 'range');

    if (useCurrent) {
      const selectedTime = getSelectedTime();
      if (!selectedTime || selectedTime === '—') {
        alert('No selected time available for this dataset.');
        logger.finishSubsetRun(run, 'cancelled', { reason: 'missing-selected-time' });
        throw new SubsetCancelled();
      }
      return { timeMode, rangeStart: '', rangeEnd: '' };
    }

    if (useFull) {
      const rangeStart = state.selectedLayer?.time?.start || state.times?.[0] || '';
      const rangeEnd = state.selectedLayer?.time?.end || state.times?.[state.times.length - 1] || '';
      if (state.times.length > NCSS_WARN_TIMESTEPS) {
        const proceed = window.confirm(`Full-range subset will request ${state.times.length} timesteps and may time out. Continue?`);
        if (!proceed) {
          logger.finishSubsetRun(run, 'cancelled', { reason: 'user-cancelled-full-time-warning' });
          throw new SubsetCancelled();
        }
      }
      return { timeMode, rangeStart, rangeEnd };
    }

    const startIso = parseSubsetDateValue(subsetTimeStart.value, 'start');
    const endIso = parseSubsetDateValue(subsetTimeEnd.value, 'end');
    if (startIso === null || endIso === null) {
      alert('Please enter dates as YYYY, YYYY-MM, YYYY-MM-DD (or with / separators).');
      logger.finishSubsetRun(run, 'cancelled', { reason: 'invalid-date-input' });
      throw new SubsetCancelled();
    }
    const rangeStart = startIso || '';
    const rangeEnd = endIso || '';
    if (rangeStart && rangeEnd && Date.parse(rangeStart) > Date.parse(rangeEnd)) {
      alert('Start date must be before end date.');
      logger.finishSubsetRun(run, 'cancelled', { reason: 'invalid-date-range' });
      throw new SubsetCancelled();
    }
    return { timeMode, rangeStart, rangeEnd };
  }

  /**
   * Fast path: the whole spatial domain and full time range were requested,
   * so we can just download the original file directly via HTTPServer
   * instead of going through ncpartitioner.
   */
  async function runFullFileDownload(run, spatialMode) {
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
        mode: ROUTE.FULL_FILE,
        file: state.currentDataset.urlPath,
        elapsedMs,
        bytes,
        bytesPerSec: (bytes > 0 && elapsedMs > 0) ? (bytes / (elapsedMs / 1000)) : null,
        at: new Date().toISOString()
      });
    } catch { /* perf logging is best-effort — don't let it block the download */ }

    logger.finishSubsetRun(run, 'ok', { route: ROUTE.FULL_FILE, spatialMode, timeMode: 'full', file: state.currentDataset.urlPath });
  }

  /** Converts the resolved bbox/time range into ncpartitioner array indexes. */
  function resolveNcpartitionerIndexes(bbox, useWholeSpatialDomain, indexInfo) {
    const [latStart, latEnd] = useWholeSpatialDomain
      ? [0, Math.max(0, indexInfo.lat.length - 1)]
      : indexController.findBoundedIndexRange(indexInfo.lat, bbox.south, bbox.north);
    const [lonStart, lonEnd] = useWholeSpatialDomain
      ? [0, Math.max(0, indexInfo.lon.length - 1)]
      : indexController.findBoundedIndexRange(indexInfo.lon, bbox.west, bbox.east);
    return { latStart, latEnd, lonStart, lonEnd };
  }

  /** Submits the ncpartitioner job and returns the parsed job + status URL. */
  async function submitNcpartitionerJob(targets) {
    const filepath = `${state.currentDataset.urlPath}.nc`;
    const partitionParams = new URLSearchParams();
    partitionParams.set('filepath', filepath);
    partitionParams.set('targets', targets);
    const partitionRequestUrl = new URL(`partition/?${partitionParams.toString()}`, ncpartitionerPublicRoot).toString();

    startStatusSpinner('Submitting subset to ncpartitioner…');
    const response = await fetch(partitionRequestUrl, { method: 'GET' });
    if (response.status !== 202) {
      throw new Error(`Unexpected ncpartitioner response: ${response.status}`);
    }

    const job = await response.json();
    if (!job?.job_id || !job?.status_url) {
      throw new Error('Invalid ncpartitioner job response');
    }
    const statusUrl = new URL(job.status_url, ncpartitionerPublicRoot).toString();
    return { job, statusUrl };
  }

  /**
   * Polls the ncpartitioner job until it completes, fails, or the run is
   * superseded/cancelled. On success, triggers the download and logs perf.
   */
  async function pollNcpartitionerJob({ run, job, statusUrl, spatialMode, timeMode, indexMs, tPartitionStart }) {
    let queuePosition = queuePositionFor(job);
    let isLongWait = false;
    startStatusSpinner(waitingStatusMessage(queuePosition, isLongWait));
    const stopBackgroundStatus = startBackgroundSubsetStatus(run.id);
    const requestStartedAt = Date.now();

    while (activeNcPollRunId === run.id) {
      const statusResponse = await fetch(statusUrl, { cache: 'no-store' });
      if (activeNcPollRunId !== run.id) return;

      if (statusResponse.status === 404) {
        throw new Error('Subset job not found');
      }
      if (!statusResponse.ok) {
        throw new Error(`Unexpected subset status response: ${statusResponse.status}`);
      }

      const statusPayload = await statusResponse.json();

      if (statusPayload.status === 'complete') {
        const downloadUrl = statusPayload.download_url || job.download_url;
        if (!downloadUrl) throw new Error('Subset completed without a download URL');

        activeNcPollRunId = null;
        stopBackgroundStatus();
        stopStatusSpinner('Subset complete. Starting download…');
        triggerBackgroundDownload(downloadUrl);

        let bytes = 0;
        try {
          const head = await fetch(`${downloadUrl}?_ts=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
          bytes = Number(head.headers.get('content-length') || 0);
        } catch { /* perf logging is best-effort */ }

        const tPartitionEnd = performance.now();
        logger.logSubsetPerf({
          mode: ROUTE.NCPARTITIONER,
          file: state.currentDataset.urlPath,
          output: job.output_filename || null,
          elapsedMs: Math.round(tPartitionEnd - tPartitionStart),
          bytes,
          bytesPerSec: (bytes > 0 && (tPartitionEnd - tPartitionStart) > 0) ? (bytes / ((tPartitionEnd - tPartitionStart) / 1000)) : null,
          spatialMode,
          timeMode,
          at: new Date().toISOString()
        });
        logger.finishSubsetRun(run, 'ok', {
          route: ROUTE.NCPARTITIONER,
          spatialMode,
          timeMode,
          indexMs,
          jobId: job.job_id,
          file: state.currentDataset.urlPath
        });
        return;
      }

      if (statusPayload.status === 'failed') {
        throw new Error(statusPayload.error || 'Subset generation failed');
      }
      if (statusPayload.status !== 'running' && statusPayload.status !== 'queued') {
        throw new Error(`Unexpected subset job status: ${statusPayload.status || 'unknown'}`);
      }

      const nextQueuePosition = queuePositionFor(statusPayload);
      const nextIsLongWait = (Date.now() - requestStartedAt) >= BACKGROUND_STATUS_TIMEOUT_MS;
      if (nextQueuePosition !== queuePosition || nextIsLongWait !== isLongWait) {
        queuePosition = nextQueuePosition;
        isLongWait = nextIsLongWait;
        startStatusSpinner(waitingStatusMessage(queuePosition, isLongWait));
      }

      const pollDelay = nextIsLongWait
        ? BACKGROUND_STATUS_SLOW_POLL_MS
        : BACKGROUND_STATUS_POLL_MS;
      await sleep(pollDelay);
    }
  }

  /** Builds the ncpartitioner request and drives it through to download. */
  async function runNcpartitionerSubset(run, { bbox, useWholeSpatialDomain, spatialMode, timeMode, rangeStart, rangeEnd, useCurrent }) {
    const tIndexStart = performance.now();
    startStatusSpinner('Converting bounds/time to ncpartitioner indexes…');
    const indexInfo = await indexController.getNcpartitionerIndexInfo(state.currentDataset.urlPath);
    const { latStart, latEnd, lonStart, lonEnd } = resolveNcpartitionerIndexes(bbox, useWholeSpatialDomain, indexInfo);
    const tIndexEnd = performance.now();
    let effectiveTimeMode = timeMode;

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

    let [timeStart, timeEnd] = indexController.findTimeIndexRange(state.times || [], timeStartIso, timeEndIso);
    const totalTimesteps = Array.isArray(state.times) ? state.times.length : 0;
    const selectedTimesteps = (timeEnd - timeStart) + 1;
    const requestedFraction = totalTimesteps > 0 ? (selectedTimesteps / totalTimesteps) : 0;

    if (timeMode !== 'full' && totalTimesteps > 0 && requestedFraction > FULL_TIME_SUGGESTION_THRESHOLD) {
      const switchToFull = window.confirm(
        `This request covers ${Math.round(requestedFraction * 100)}% of the available timesteps. `
        + 'Switch to the full time range for this spatial subset instead? This is usually faster for you and better for other users.'
      );
      if (switchToFull) {
        timeStart = 0;
        timeEnd = totalTimesteps - 1;
        effectiveTimeMode = 'full';
      }
    }

    const targets = [
      `time[${timeStart}:${timeEnd}]`,
      `lat[${latStart}:${latEnd}]`,
      `lon[${lonStart}:${lonEnd}]`,
      `${state.variable}[${timeStart}:${timeEnd}][${latStart}:${latEnd}][${lonStart}:${lonEnd}]`
    ].join(',');

    const tPartitionStart = performance.now();
    const { job, statusUrl } = await submitNcpartitionerJob(targets);

    await pollNcpartitionerJob({
      run,
      job,
      statusUrl,
      spatialMode,
      timeMode: effectiveTimeMode,
      indexMs: Math.round(tIndexEnd - tIndexStart),
      tPartitionStart
    });
  }

  async function downloadSubset() {
    if (subsetDownloadBtn.disabled) return;
    if (!state.currentDataset) return alert('Please select a dataset first');
    if (!state.variable) return alert('Could not infer variable for this file.');

    setSubsetDownloadBusy(true);
    const run = logger.startSubsetRun('subset-download', { portal: portal.id, dataset: state.currentDataset?.urlPath || null });
    activeNcPollRunId = run.id;

    const spatialMode = (subsetSpatialMode?.value || 'viewport').toLowerCase();
    let timeMode = 'range';

    try {
      const { bbox, useWholeSpatialDomain } = resolveSpatialExtent(spatialMode, run);
      const { timeMode: resolvedTimeMode, rangeStart, rangeEnd } = await resolveTimeRange(run);
      timeMode = resolvedTimeMode;

      if (useWholeSpatialDomain && timeMode === 'full') {
        await runFullFileDownload(run, spatialMode);
        return;
      }

      await runNcpartitionerSubset(run, {
        bbox,
        useWholeSpatialDomain,
        spatialMode,
        timeMode,
        rangeStart,
        rangeEnd,
        useCurrent: timeMode === 'current'
      });
    } catch (error) {
      if (error instanceof SubsetCancelled) {
        setSubsetDownloadBusy(false);
        return;
      }
      activeNcPollRunId = null;
      console.error(error);
      cancelPendingSubsetStatus();
      stopStatusSpinner(`Subset failed: ${error?.message || error}`, true);
      logger.finishSubsetRun(run, 'error', {
        route: ROUTE.NCPARTITIONER,
        spatialMode,
        timeMode,
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
