/** Builds calendar-neutral date records from display timestamps. */
export function calendarDateRecords(times, formatDate) {
  return times.map((time, index) => {
    const match = formatDate(time).match(/^([+-]?\d+)-(\d{2})-(\d{2})$/);
    return match ? { index, year: match[1], month: match[2], day: match[3] } : null;
  }).filter(Boolean);
}

/** Returns the End timestep to use when a new Start passes the current End. */
export function adjustedEndIndex(times, formatDate, startValue, endValue) {
  const startIndex = times.findIndex((time) => formatDate(time) === startValue);
  const endIndex = times.findIndex((time) => formatDate(time) === endValue);
  if (startIndex < 0 || endIndex < 0 || startIndex <= endIndex) return null;
  return Math.min(startIndex + 1, times.length - 1);
}

/** Renders a year/month/day picker from available date records. */
export function renderCalendarPicker({
  container,
  records,
  selectedIndex,
  selectionDatasetKey,
  isDisabled = () => false,
  onClose = () => {},
  year,
  month
}) {
  if (!container) return;
  if (!records.length) {
    container.replaceChildren();
    return;
  }

  const selected = records.find((record) => record.index === selectedIndex) || records[0];
  const selectedYear = year || selected.year;
  const years = [...new Set(records.map((record) => record.year))]
    .sort((a, b) => Number(a) - Number(b));
  const months = [...new Set(records
    .filter((record) => record.year === selectedYear)
    .map((record) => record.month))]
    .sort();
  const selectedMonth = months.includes(month)
    ? month
    : selected.year === selectedYear && months.includes(selected.month) ? selected.month : months[0];
  const days = records.filter((record) => record.year === selectedYear && record.month === selectedMonth);
  const availableDays = days.filter((record) => !isDisabled(record));
  const preview = availableDays.find((record) => record.day === selected.day)
    || availableDays.reduce((nearest, record) => (
      !nearest || Math.abs(Number(record.day) - Number(selected.day)) < Math.abs(Number(nearest.day) - Number(selected.day))
        ? record : nearest
    ), null);
  if (preview) container.dataset.previewIndex = String(preview.index);
  else delete container.dataset.previewIndex;

  const controls = document.createElement("div");
  controls.className = "time-calendar-controls";
  const yearSelect = document.createElement("select");
  years.forEach((value) => {
    const option = new Option(value, value, false, value === selectedYear);
    option.disabled = records.filter((record) => record.year === value).every(isDisabled);
    yearSelect.add(option);
  });
  const monthSelect = document.createElement("select");
  months.forEach((value) => {
    const option = new Option(value, value, false, value === selectedMonth);
    option.disabled = records.filter((record) => record.year === selectedYear && record.month === value).every(isDisabled);
    monthSelect.add(option);
  });
  yearSelect.addEventListener("change", () => renderCalendarPicker({
    container, records, selectedIndex, selectionDatasetKey, isDisabled, onClose, year: yearSelect.value, month: monthSelect.value
  }));
  monthSelect.addEventListener("change", () => renderCalendarPicker({
    container, records, selectedIndex, selectionDatasetKey, isDisabled, onClose, year: selectedYear, month: monthSelect.value
  }));
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "time-calendar-close";
  closeButton.dataset.calendarClose = "true";
  closeButton.setAttribute("aria-label", "Close calendar");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", onClose);
  controls.append(yearSelect, monthSelect, closeButton);

  const dayGrid = document.createElement("div");
  dayGrid.className = "time-calendar-days";
  days.forEach((record) => {
    const day = document.createElement("button");
    day.type = "button";
    day.dataset[selectionDatasetKey] = String(record.index);
    day.textContent = record.day;
    day.disabled = isDisabled(record);
    day.setAttribute("aria-pressed", String(record.index === preview?.index));
    dayGrid.append(day);
  });
  container.replaceChildren(controls, dayGrid);
}
