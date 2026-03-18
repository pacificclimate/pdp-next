export const timeModeBtns = document.querySelectorAll('.time-mode-btn');
export const opacitySlider = document.getElementById('opacity');
export const timeSlider = document.getElementById('timeSlider');
export const timeSliderContainer = document.getElementById('timeSliderContainer');
export const timeValue = document.getElementById('timeValue');
export const statusText = document.getElementById('statusText');
export const datasetName = document.getElementById('datasetName');
export const variableInfo = document.getElementById('variableInfo');
export const timeInfo = document.getElementById('timeInfo');
export const metadataBtn = document.getElementById('metadataBtn');
export const paletteSelect = document.getElementById('paletteSelect');
export const scaleMin = document.getElementById('scaleMin');
export const scaleMax = document.getElementById('scaleMax');
export const numColors = document.getElementById('numColors');
export const applyScaleBtn = document.getElementById('applyScaleBtn');
export const styleSelect = document.getElementById('styleSelect');
export const legendPanel = document.getElementById('legendPanel');
export const legendImage = document.getElementById('legendImage');
export const legendTitle = document.getElementById('legendTitle');
export const legendMin = document.getElementById('legendMin');
export const legendMax = document.getElementById('legendMax');
export const viewerTitleElement = document.getElementById('viewerTitle');
export const portalSelect = document.getElementById('ensembleSelect');
export const datasetMenu = document.getElementById('datasetMenu');
export const crsSelect = document.getElementById('crsSelect');
export const subsetFullTime = document.getElementById('subsetFullTime');
export const subsetCurrentTime = document.getElementById('subsetCurrentTime');
export const subsetTimeStart = document.getElementById('subsetTimeStart');
export const subsetTimeEnd = document.getElementById('subsetTimeEnd');
export const subsetSpatialMode = document.getElementById('subsetSpatialMode');
export const subsetClearDraw = document.getElementById('subsetClearDraw');
export const subsetDownloadBtn = document.getElementById('subsetDownloadBtn');

const STATUS_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

let statusSpinnerTimer = null;
let statusSpinnerFrame = 0;
let statusSpinnerStartedAt = 0;
let statusSuppressed = false;

export function suppressStatusUpdates() { statusSuppressed = true; }
export function unsuppressStatusUpdates() { statusSuppressed = false; }

export function setStatus(message, isError = false) {
  if (statusSuppressed && !isError) return;
  statusText.textContent = message;
  statusText.style.color = isError ? '#d32f2f' : 'var(--text-muted)';
}

export function forceSetStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? '#d32f2f' : 'var(--text-muted)';
}

export function startStatusSpinner(message) {
  if (statusSpinnerTimer) clearInterval(statusSpinnerTimer);
  statusSpinnerFrame = 0;
  statusSpinnerStartedAt = Date.now();
  setStatus(`${STATUS_SPINNER_FRAMES[statusSpinnerFrame]} ${message} (0s)`);
  statusSpinnerTimer = setInterval(() => {
    statusSpinnerFrame = (statusSpinnerFrame + 1) % STATUS_SPINNER_FRAMES.length;
    const elapsedSeconds = Math.floor((Date.now() - statusSpinnerStartedAt) / 1000);
    setStatus(`${STATUS_SPINNER_FRAMES[statusSpinnerFrame]} ${message} (${elapsedSeconds}s)`);
  }, 160);
}

export function stopStatusSpinner(message, isError = false) {
  if (statusSpinnerTimer) {
    clearInterval(statusSpinnerTimer);
    statusSpinnerTimer = null;
  }
  if (message) setStatus(message, isError);
}