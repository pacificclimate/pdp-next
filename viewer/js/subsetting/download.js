export function createSubsetDownloadController({
  state,
  portal,
  ui,
  status,
  services,
  time,
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
  let activeSubsetRunId = null;
  let activeFetchController = null;
  const ncpartitionerPublicRoot = new URL(ncpartitionerBase(), window.location.origin);

  function setSubsetDownloadBusy(isBusy) {
    subsetDownloadBtn.disabled = isBusy;
    subsetDownloadBtn.textContent = isBusy ? `${SUBSET_DOWNLOAD_LABEL}...` : SUBSET_DOWNLOAD_LABEL;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function replaceActiveFetchController() {
    activeFetchController?.abort();
    activeFetchController = new AbortController();
    return activeFetchController;
  }

  function clearActiveFetchController(controller = activeFetchController) {
    if (controller && activeFetchController === controller) activeFetchController = null;
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

  function chunkProgressFor(payload) {
    const complete = payload?.chunks_complete ?? payload?.chunksComplete ?? null;
    const total = payload?.chunks_total ?? payload?.chunksTotal ?? null;
    if (!Number.isInteger(complete) || !Number.isInteger(total) || total <= 0) return null;
    return { complete, total };
  }

  async function promptLargeSubsetChoice(requestedFraction) {
    const message = `This request covers ${Math.round(requestedFraction * 100)}% of the available timesteps. `
      + 'Downloading the full time range for this spatial subset is usually faster for you and better for other users.';
    const dialog = document.getElementById('largeSubsetDialog');
    const messageEl = document.getElementById('largeSubsetDialogMessage');

    if (!(dialog instanceof HTMLDialogElement) || !messageEl) {
      const continueSubset = window.confirm(
        `${message}\n\nPress OK to continue with subset generation.\nPress Cancel to switch to the full time range instead.`
      );
      return continueSubset ? 'continue' : 'full';
    }

    messageEl.textContent = message;
    dialog.returnValue = 'cancel';
    dialog.showModal();

    const choice = await new Promise((resolve) => {
      const onClose = () => {
        cleanup();
        resolve(dialog.returnValue || 'cancel');
      };
      const onCancel = (event) => {
        event.preventDefault();
        dialog.close('cancel');
      };
      const onClick = (event) => {
        if (event.target === dialog) dialog.close('cancel');
      };
      const cleanup = () => {
        dialog.removeEventListener('close', onClose);
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('click', onClick);
      };
      dialog.addEventListener('close', onClose);
      dialog.addEventListener('cancel', onCancel);
      dialog.addEventListener('click', onClick);
    });

    return choice === 'full' ? 'full' : (choice === 'continue' ? 'continue' : 'cancel');
  }

  function waitingStatusMessage(queuePosition, isLongWait = false) {
    const baseMessage = isLongWait ? SUBSET_LONG_WAIT_STATUS : SUBSET_WAITING_STATUS;
    return queuePosition !== null
      ? `${baseMessage} Queue position: ${queuePosition}.`
      : baseMessage;
  }

  function runningStatusMessage(payload, isLongWait = false) {
    const phase = String(payload?.phase || '').toLowerCase();
    const chunkProgress = chunkProgressFor(payload);

    if (phase === 'extracting' && chunkProgress) {
      return `Subset processing. Extracted ${chunkProgress.complete}/${chunkProgress.total} chunks.`;
    }
    if (phase === 'merging' && chunkProgress) {
      return `Subset processing. Merging ${chunkProgress.total} extracted chunks.`;
    }

    return waitingStatusMessage(queuePositionFor(payload), isLongWait);
  }

  function cancelPendingSubsetStatus(message = '', isError = false) {
    activeNcPollRunId = null;
    activeSubsetRunId = null;
    activeFetchController?.abort();
    activeFetchController = null;
    clearBackgroundSubsetStatus();
    stopStatusSpinner(message, isError);
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

    const fullRangeStart = state.selectedLayer?.time?.start || state.times?.[0] || '';
    const fullRangeEnd = state.selectedLayer?.time?.end || state.times?.[state.times.length - 1] || fullRangeStart;
    if (state.times.length) {
      const [timeStartIndex, timeEndIndex] = indexController.findTimeIndexRange(state.times, rangeStart || fullRangeStart, rangeEnd || fullRangeEnd);
      if (timeStartIndex === 0 && timeEndIndex === (state.times.length - 1)) {
        return { timeMode: 'full', rangeStart: fullRangeStart, rangeEnd: fullRangeEnd };
      }
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
  async function submitNcpartitionerJob(targets, signal) {
    const filepath = /\.nc4?$/i.test(state.currentDataset.urlPath)
      ? state.currentDataset.urlPath
      : `${state.currentDataset.urlPath}.nc`;
    const partitionParams = new URLSearchParams();
    partitionParams.set('filepath', filepath);
    partitionParams.set('targets', targets);
    const partitionRequestUrl = new URL(`partition/?${partitionParams.toString()}`, ncpartitionerPublicRoot).toString();

    startStatusSpinner('Submitting subset to ncpartitioner…');
    const response = await fetch(partitionRequestUrl, { method: 'GET', signal });
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
    let lastStatusMessage = waitingStatusMessage(queuePositionFor(job));
    let isLongWait = false;
    startStatusSpinner(lastStatusMessage);
    const stopBackgroundStatus = startBackgroundSubsetStatus(run.id);
    const requestStartedAt = Date.now();

    while (activeNcPollRunId === run.id) {
      const statusResponse = await fetch(statusUrl, { cache: 'no-store', signal: activeFetchController?.signal });
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
        activeSubsetRunId = null;
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

      const nextIsLongWait = (Date.now() - requestStartedAt) >= BACKGROUND_STATUS_TIMEOUT_MS;
      const nextStatusMessage = statusPayload.status === 'queued'
        ? waitingStatusMessage(queuePositionFor(statusPayload), nextIsLongWait)
        : runningStatusMessage(statusPayload, nextIsLongWait);
      if (nextStatusMessage !== lastStatusMessage || nextIsLongWait !== isLongWait) {
        lastStatusMessage = nextStatusMessage;
        isLongWait = nextIsLongWait;
        startStatusSpinner(nextStatusMessage);
      }

      const pollDelay = nextIsLongWait
        ? BACKGROUND_STATUS_SLOW_POLL_MS
        : BACKGROUND_STATUS_POLL_MS;
      await sleep(pollDelay);
    }
  }

  /** Builds the ncpartitioner request and drives it through to download. */
  async function runNcpartitionerSubset(run, { bbox, useWholeSpatialDomain, spatialMode, timeMode, rangeStart, rangeEnd, useCurrent }) {
    const fetchController = replaceActiveFetchController();
    const tIndexStart = performance.now();
    startStatusSpinner('Converting bounds/time to ncpartitioner indexes…');
    try {
      const indexInfo = await indexController.getNcpartitionerIndexInfo(state.currentDataset.urlPath);
      const { latStart, latEnd, lonStart, lonEnd } = resolveNcpartitionerIndexes(bbox, useWholeSpatialDomain, indexInfo);
      const tIndexEnd = performance.now();
      let effectiveTimeMode = timeMode;
      const actualTimeCount = Math.max(0, Number(indexInfo.timeCount || 0));

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
      if (actualTimeCount > 0) {
        timeStart = Math.max(0, Math.min(timeStart, actualTimeCount - 1));
        timeEnd = Math.max(timeStart, Math.min(timeEnd, actualTimeCount - 1));
      }

      const totalTimesteps = actualTimeCount || (Array.isArray(state.times) ? state.times.length : 0);
      const selectedTimesteps = (timeEnd - timeStart) + 1;
      const requestedFraction = totalTimesteps > 0 ? (selectedTimesteps / totalTimesteps) : 0;

      if (timeMode !== 'full' && totalTimesteps > 0 && requestedFraction > FULL_TIME_SUGGESTION_THRESHOLD) {
        const choice = await promptLargeSubsetChoice(requestedFraction);
        if (choice === 'cancel') {
          logger.finishSubsetRun(run, 'cancelled', { reason: 'user-dismissed-large-subset-choice' });
          throw new SubsetCancelled('Subset request cancelled.');
        }
        if (choice === 'full') {
          timeStart = 0;
          timeEnd = totalTimesteps - 1;
          effectiveTimeMode = 'full';
          if (useWholeSpatialDomain) {
            await runFullFileDownload(run, spatialMode);
            return;
          }
        }
      }

      const targets = [
        `time[${timeStart}:${timeEnd}]`,
        `lat[${latStart}:${latEnd}]`,
        `lon[${lonStart}:${lonEnd}]`,
        `${state.variable}[${timeStart}:${timeEnd}][${latStart}:${latEnd}][${lonStart}:${lonEnd}]`
      ].join(',');

      const tPartitionStart = performance.now();
      const { job, statusUrl } = await submitNcpartitionerJob(targets, fetchController.signal);

      await pollNcpartitionerJob({
        run,
        job,
        statusUrl,
        spatialMode,
        timeMode: effectiveTimeMode,
        indexMs: Math.round(tIndexEnd - tIndexStart),
        tPartitionStart
      });
    } finally {
      clearActiveFetchController(fetchController);
    }
  }

  async function downloadSubset() {
    if (activeSubsetRunId) {
      setStatus('A subset request is already running.');
      return;
    }
    if (subsetDownloadBtn.disabled) return;
    if (!state.currentDataset) return alert('Please select a dataset first');
    if (!state.variable) return alert('Could not infer variable for this file.');

    setSubsetDownloadBusy(true);
    const run = logger.startSubsetRun('subset-download', { portal: portal.id, dataset: state.currentDataset?.urlPath || null });
    activeSubsetRunId = run.id;
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
      if (error instanceof SubsetCancelled || error?.name === 'AbortError') {
        cancelPendingSubsetStatus(error instanceof SubsetCancelled ? error.message : '');
        return;
      }
      activeNcPollRunId = null;
      activeSubsetRunId = null;
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
      if (activeSubsetRunId === run.id && !activeBackgroundStatus) activeSubsetRunId = null;
      if (!activeBackgroundStatus) setSubsetDownloadBusy(false);
    }
  }

  return {
    downloadSubset,
    cancelPendingSubsetStatus
  };
}
