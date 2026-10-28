// Display labels only; dataset metadata and WMS values retain their source units.
const UNIT_LABELS = new Map([
  ["degc", "°C"],
  ["degrees_c", "°C"],
  ["celsius", "°C"],
  ["mm d-1", "mm/day"],
  ["mm day-1", "mm/day"],
  ["mm/day", "mm/day"],
  ["kg m-2 d-1", "mm/day"],
  ["meters s-1", "m/s"],
  ["kg m-2", "kg/m²"],
  ["1", "fraction"],
]);

export function formatDisplayUnits(units) {
  const value = String(units ?? "").trim();
  return UNIT_LABELS.get(value.toLowerCase()) || value;
}
