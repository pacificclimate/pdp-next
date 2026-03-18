export function createTimeUiController({
  state,
  timeModeBtns,
  timeSlider,
  timeSliderContainer,
  timeValue,
  subsetFullTime,
  subsetCurrentTime,
  subsetTimeStart,
  subsetTimeEnd,
  parseHelpers
}) {
  const {
    formatSeasonLabel,
    formatMonthLabel,
    formatDailyLabel
  } = parseHelpers;

  function allowsRangeSubset() {
    return Number(state.currentDataset?.timeMetadata?.count || state.times?.length || 0) > 12;
  }

  function normalizeSubsetTimeSelection() {
    if (!allowsRangeSubset() && !subsetFullTime.checked && !subsetCurrentTime.checked) {
      subsetFullTime.checked = true;
    }
  }

  function syncSubsetTimeRangeVisibility() {
    normalizeSubsetTimeSelection();
    const showRangeSubset = allowsRangeSubset() && !subsetFullTime.checked && !subsetCurrentTime.checked;
    subsetTimeStart?.closest('.color-row')?.classList.toggle('is-hidden', !showRangeSubset);
    subsetTimeEnd?.closest('.color-row')?.classList.toggle('is-hidden', !showRangeSubset);
  }

  function getSelectedTime() {
    if (!state.times.length) return '—';
    const idx = Math.max(0, Math.min(state.times.length - 1, parseInt(timeSlider.value || '0', 10) || 0));
    return state.times[idx];
  }

  function getSelectedTimeLabel() {
    const selected = getSelectedTime();
    if (selected === '—') return selected;
    if (state.times.length === 12) return formatMonthLabel(selected);
    if (state.times.length === 4) {
      const labels = state.times.map(formatSeasonLabel);
      const unique = new Set(labels);
      if (['DJF', 'MAM', 'JJA', 'SON'].some((v) => unique.has(v))) {
        const idx = Math.max(0, Math.min(state.times.length - 1, parseInt(timeSlider.value || '0', 10) || 0));
        return labels[idx] || selected;
      }
    }
    return formatDailyLabel(selected);
  }

  function setTimeButtonsEnabled(enabled) {
    timeModeBtns.forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle('disabled', !enabled);
    });
  }

  function updateTimeUI() {
    const hasAny = state.times.length > 0;
    timeSliderContainer.classList.toggle('disabled', !hasAny);
    timeSlider.disabled = !hasAny;
    timeSlider.max = String(Math.max(0, state.times.length - 1));
    timeSlider.value = String(Math.min(parseInt(timeSlider.value || '0', 10) || 0, Math.max(0, state.times.length - 1)));
    setTimeButtonsEnabled(hasAny);
    timeValue.textContent = getSelectedTimeLabel();
    syncSubsetTimeRangeVisibility();
    updateSubsetTimeInputsEnabled();
  }

  function updateSubsetTimeInputsEnabled() {
    const enabled = allowsRangeSubset()
      && !subsetFullTime.checked
      && !subsetCurrentTime.checked;
    subsetTimeStart.disabled = !enabled;
    subsetTimeEnd.disabled = !enabled;
  }

  return {
    allowsRangeSubset,
    normalizeSubsetTimeSelection,
    syncSubsetTimeRangeVisibility,
    getSelectedTime,
    getSelectedTimeLabel,
    updateTimeUI,
    updateSubsetTimeInputsEnabled
  };
}
