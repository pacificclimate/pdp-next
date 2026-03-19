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

  function getSelectedTimeIndex() {
    if (!state.times.length) return 0;
    return Math.max(
      0,
      Math.min(
        state.times.length - 1,
        parseInt(timeSlider.value || '0', 10) || 0
      )
    );
  }

  function hasMultipleTimes() {
    return state.times.length > 1;
  }

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
    return state.times[getSelectedTimeIndex()];
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
    const currentIndex = getSelectedTimeIndex();
    const lastIndex = Math.max(0, state.times.length - 1);
    timeModeBtns.forEach((button) => {
      let buttonEnabled = enabled;
      const mode = String(button.dataset.mode || '').toLowerCase();
      if (buttonEnabled && (mode === 'first' || mode === 'prev')) {
        buttonEnabled = currentIndex > 0;
      } else if (buttonEnabled && (mode === 'next' || mode === 'last')) {
        buttonEnabled = currentIndex < lastIndex;
      }
      button.disabled = !buttonEnabled;
      button.classList.toggle('disabled', !buttonEnabled);
    });
  }

  function updateTimeUI() {
    const hasAny = state.times.length > 0;
    const multiTime = hasMultipleTimes();
    const timeModeGroup = timeModeBtns?.[0]?.closest('.time-mode-group');
    if (timeModeGroup) timeModeGroup.classList.toggle('is-hidden', !multiTime);
    timeSliderContainer.classList.toggle('disabled', !multiTime);
    timeSliderContainer.classList.toggle('is-hidden', !multiTime);
    timeSlider.disabled = !multiTime;
    timeSlider.max = String(Math.max(0, state.times.length - 1));
    timeSlider.value = String(getSelectedTimeIndex());
    setTimeButtonsEnabled(hasAny && multiTime);
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
    getSelectedTimeIndex,
    getSelectedTimeLabel,
    updateTimeUI,
    updateSubsetTimeInputsEnabled,
    hasMultipleTimes
  };
}
