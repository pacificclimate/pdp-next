import assert from "node:assert/strict";
import { test } from "vitest";

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  removeAttribute(name) { this.attributes.delete(name); }
  closest() { return null; }
  contains(target) { return target === this; }
  replaceChildren() {}
  append() {}
}

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
};

globalThis.document = {
  querySelectorAll: () => [],
  getElementById: element,
  addEventListener() {},
  createElement: () => new FakeElement(),
};
globalThis.window = { clearTimeout() {}, setTimeout() { return 0; } };

const { wireEvents } = await import("../viewer/js/events.js");
const timeSlider = element("timeSlider");
const timeValue = element("timeValue");
const timeCalendar = element("timeCalendar");
const subsetStart = element("subsetTimeStart");
const subsetEnd = element("subsetTimeEnd");
const statusText = element("statusText");
const times = ["1945-01-01", "1945-01-02", "1945-01-03"];
let selectedIndex = 0;
let adjustment = null;
let rangeValidation = { valid: true };

function wire() {
  selectedIndex = 0;
  timeSlider.value = "0";
  timeValue.value = times[0];
  subsetStart.value = times[0];
  subsetEnd.value = times[2];
  statusText.textContent = "";
  const refreshes = { map: 0, info: 0, url: 0 };
  wireEvents({
    state: { times },
    activePortalId: "test",
    getSubsetTimeMode: () => "range",
    getSelectedTimeIndex: () => Number(timeSlider.value),
    getSelectedTimeLabel: () => times[Number(timeSlider.value)],
    hasMultipleTimes: () => true,
    updateTimeUI: () => { timeValue.value = times[selectedIndex]; },
    normalizeSubsetTimeSelection() {},
    syncSubsetTimeRangeVisibility() {},
    updateSubsetTimeInputsEnabled() {},
    selectTimeFromDateInput: (value) => {
      const index = times.indexOf(value);
      return index < 0 ? { valid: false, message: "invalid date" } : { valid: true, index };
    },
    toggleTimeCalendar() {},
    closeTimeCalendars() {},
    toggleSubsetTimeCalendar() {},
    applySubsetTimeCalendarSelection() {},
    validateSubsetTimeRange: () => rangeValidation,
    adjustSubsetEndForStart: () => adjustment?.() || null,
    refreshInfoPanel: () => { refreshes.info += 1; },
    updateMap: () => { refreshes.map += 1; },
    setLayerOpacity() {},
    syncPaletteEnabled() {},
    setMapProjection: () => true,
    getCurrentCrs: () => "EPSG:4326",
    setSubsetDrawMode() {},
    clearSubsetDrawing() {},
    downloadSubset() {},
    viewerStateChanged: () => { refreshes.url += 1; },
  });
  return refreshes;
}

const refreshes = wire();

test("typed date selection synchronizes the slider, map, and displayed date", () => {
  refreshes.map = refreshes.info = refreshes.url = 0;
  timeValue.value = "1945-01-03";
  timeValue.dispatchEvent(new Event("change"));

  assert.equal(timeSlider.value, "2");
  assert.equal(timeValue.value, "1945-01-03");
  assert.deepEqual(refreshes, { map: 1, info: 1, url: 1 });
});

test("slider movement synchronizes the displayed date", () => {
  refreshes.map = refreshes.info = refreshes.url = 0;
  selectedIndex = 1;
  timeSlider.value = "1";
  timeSlider.dispatchEvent(new Event("input"));

  assert.equal(timeValue.value, "1945-01-02");
  assert.deepEqual(refreshes, { map: 1, info: 1, url: 1 });
});

test("calendar day selection synchronizes the slider and displayed date", () => {
  refreshes.map = refreshes.info = refreshes.url = 0;
  timeSlider.value = "0";
  timeCalendar.closest = (selector) => selector === "button[data-time-index]"
    ? { dataset: { timeIndex: "2" } } : null;
  timeCalendar.dispatchEvent(new Event("click"));

  assert.equal(timeSlider.value, "2");
  assert.equal(timeValue.value, "1945-01-03");
  assert.deepEqual(refreshes, { map: 1, info: 1, url: 1 });
  delete timeCalendar.closest;
});

test("Start adjustment reports the next available End date", () => {
  rangeValidation = { valid: false, field: "range" };
  adjustment = () => ({ input: subsetEnd, value: "1945-01-03", isFinalTimestep: false });
  subsetStart.dispatchEvent(new Event("change"));
  assert.equal(statusText.textContent, "End date adjusted to the next available date (1945-01-03).");
});

test("Start adjustment reports the final-timestep fallback", () => {
  rangeValidation = { valid: false, field: "range" };
  adjustment = () => ({ input: subsetEnd, value: "1945-01-03", isFinalTimestep: true });
  subsetStart.dispatchEvent(new Event("change"));
  assert.equal(statusText.textContent, "End date adjusted to the latest available date (1945-01-03).");
});
