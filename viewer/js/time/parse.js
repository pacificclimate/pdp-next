function cfDateParts(value) {
  return String(value || '').trim().match(/^([+-]?\d+)-(\d{2})-(\d{2})(?:T|\s|$)/);
}

function cfMonth(value) {
  const parts = cfDateParts(value);
  return parts ? Number(parts[2]) : null;
}

export function createTimeParseHelpers() {
  function formatSeasonLabel(timeValue) {
    const raw = String(timeValue || '').trim();
    if (/^(DJF|MAM|JJA|SON)$/i.test(raw)) return raw.toUpperCase();
    const month = cfMonth(raw);
    if ([12, 1, 2].includes(month)) return 'DJF';
    if ([3, 4, 5].includes(month)) return 'MAM';
    if ([6, 7, 8].includes(month)) return 'JJA';
    if ([9, 10, 11].includes(month)) return 'SON';
    return raw;
  }

  function formatMonthLabel(timeValue) {
    const month = cfMonth(timeValue);
    if (!month) return String(timeValue || '').trim();
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
  }

  function formatDailyLabel(timeValue) {
    const parts = cfDateParts(timeValue);
    return parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : String(timeValue || '');
  }

  function toDateInputValue(value) {
    const parts = cfDateParts(value);
    return parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : '';
  }

  return { formatSeasonLabel, formatMonthLabel, formatDailyLabel, toDateInputValue };
}
