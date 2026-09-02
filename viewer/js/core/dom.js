export const timeModeBtns = document.querySelectorAll('.time-mode-btn');
export const opacitySlider = document.getElementById('opacity');
export const timeSlider = document.getElementById('timeSlider');
export const timeSliderContainer = document.getElementById('timeSliderContainer');
export const timeValue = document.getElementById('timeValue');
export const statusText = document.getElementById('statusText');
const statusHistoryToggle = document.getElementById('statusHistoryToggle');
const statusHistoryPanel = document.getElementById('statusHistoryPanel');
const statusHistoryList = document.getElementById('statusHistoryList');
const statusHistoryClear = document.getElementById('statusHistoryClear');
export const datasetName = document.getElementById('datasetName');
export const variableInfo = document.getElementById('variableInfo');
export const selectionVariableIcon = document.getElementById('selectionVariableIcon');
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
export const subsetTimeModeFull = document.getElementById('subsetTimeModeFull');
export const subsetTimeModeCurrent = document.getElementById('subsetTimeModeCurrent');
export const subsetTimeModeRange = document.getElementById('subsetTimeModeRange');
export const subsetTimeModeInputs = document.querySelectorAll('input[name="subsetTimeMode"]');
export const subsetTimeStart = document.getElementById('subsetTimeStart');
export const subsetTimeEnd = document.getElementById('subsetTimeEnd');
export const subsetSpatialMode = document.getElementById('subsetSpatialMode');
export const subsetClearDraw = document.getElementById('subsetClearDraw');
export const subsetDownloadBtn = document.getElementById('subsetDownloadBtn');

const STATUS_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_READY_STATUS = 'Ready';
const STATUS_RESET_DELAY_MS = 4000;
const STATUS_HISTORY_LIMIT = 100;

let statusSpinnerTimer = null;
let statusSpinnerFrame = 0;
let statusSpinnerStartedAt = 0;
let statusSuppressed = false;
let statusResetTimer = null;
let nextStatusHistoryId = 1;
const statusHistory = [];

function historyMessage(message) {
  return String(message ?? '')
    .replace(/^[\u2800-\u28ff]\s+/u, '')
    .replace(/\s+\(\d+s\)$/u, '')
    .trim();
}

function historyTime(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderStatusHistory() {
  if (!statusHistoryList || statusHistoryPanel?.hidden) return;
  statusHistoryList.replaceChildren();

  if (!statusHistory.length) {
    const empty = document.createElement('li');
    empty.className = 'status-history-empty';
    empty.textContent = 'No activity recorded.';
    statusHistoryList.append(empty);
    return;
  }

  statusHistory.forEach((entry) => {
    const item = document.createElement('li');
    item.className = `status-history-item${entry.isError ? ' is-error' : ''}`;

    const time = document.createElement('time');
    time.className = 'status-history-time';
    time.dateTime = entry.at.toISOString();
    time.textContent = historyTime(entry.at);

    const message = document.createElement('span');
    message.className = 'status-history-message';
    message.textContent = entry.message;

    item.append(time, message);
    statusHistoryList.append(item);
  });
}

function recordStatus(message, isError) {
  const normalizedMessage = historyMessage(message);
  if (!normalizedMessage) return;

  const latest = statusHistory[0];
  if (latest?.message === normalizedMessage && latest.isError === isError) return;

  statusHistory.unshift({
    id: nextStatusHistoryId++,
    message: normalizedMessage,
    isError,
    at: new Date()
  });
  if (statusHistory.length > STATUS_HISTORY_LIMIT) statusHistory.length = STATUS_HISTORY_LIMIT;
  renderStatusHistory();
}

function setStatusHistoryOpen(open) {
  if (!statusHistoryToggle || !statusHistoryPanel) return;
  statusHistoryPanel.hidden = !open;
  statusHistoryToggle.setAttribute('aria-expanded', String(open));
  statusHistoryToggle.title = open ? 'Hide status history' : 'Show status history';
  if (open) renderStatusHistory();
}

statusHistoryToggle?.addEventListener('click', () => {
  setStatusHistoryOpen(statusHistoryToggle.getAttribute('aria-expanded') !== 'true');
});

statusHistoryClear?.addEventListener('click', () => {
  statusHistory.length = 0;
  renderStatusHistory();
});

export function suppressStatusUpdates() { statusSuppressed = true; }
export function unsuppressStatusUpdates() { statusSuppressed = false; }

function clearStatusResetTimer() {
  if (!statusResetTimer) return;
  window.clearTimeout(statusResetTimer);
  statusResetTimer = null;
}

function scheduleStatusReset(isError) {
  clearStatusResetTimer();
  if (isError) return;
  statusResetTimer = setTimeout(() => {
    statusText.textContent = DEFAULT_READY_STATUS;
    statusText.style.color = 'var(--text-muted)';
    statusResetTimer = null;
  }, STATUS_RESET_DELAY_MS);
}

export function setStatus(message, isError = false) {
  if (statusSuppressed && !isError) return;
  clearStatusResetTimer();
  statusText.textContent = message;
  statusText.style.color = isError ? '#d32f2f' : 'var(--text-muted)';
  recordStatus(message, isError);
  scheduleStatusReset(isError);
}

export function forceSetStatus(message, isError = false) {
  clearStatusResetTimer();
  statusText.textContent = message;
  statusText.style.color = isError ? '#d32f2f' : 'var(--text-muted)';
  recordStatus(message, isError);
  scheduleStatusReset(isError);
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

recordStatus(DEFAULT_READY_STATUS, false);
