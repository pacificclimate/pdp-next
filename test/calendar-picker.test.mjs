import assert from "node:assert/strict";
import { test } from "vitest";

import {
  adjustedEndIndex,
  calendarDateRecords,
} from "../viewer/js/time/calendar-picker.js";

const dates = ["1945-01-01", "1945-01-02", "1945-01-03"];
const formatDate = (value) => value;

test("creates calendar-neutral date records", () => {
  assert.deepEqual(calendarDateRecords(["1945-01-01T12:00:00Z", "1945-02-30T12:00:00Z"],
    (value) => value.slice(0, 10)), [
    { index: 0, year: "1945", month: "01", day: "01" },
    { index: 1, year: "1945", month: "02", day: "30" },
  ]);
});

test("advances End to the next available timestep when Start passes it", () => {
  assert.equal(adjustedEndIndex(dates, formatDate, "1945-01-03", "1945-01-01"), 2);
  assert.equal(adjustedEndIndex(dates, formatDate, "1945-01-02", "1945-01-01"), 2);
  assert.equal(adjustedEndIndex(dates, formatDate, "1945-01-01", "1945-01-03"), null);
  assert.equal(adjustedEndIndex(dates, formatDate, "missing", "1945-01-01"), null);
});
