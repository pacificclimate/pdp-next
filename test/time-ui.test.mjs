import assert from "node:assert/strict";
import { test } from "vitest";

import { createTimeUiController } from "../viewer/js/time/ui.js";

function control() {
  return {
    value: "",
    hidden: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function controller(times) {
  const subsetTimeStart = control();
  const subsetTimeEnd = control();
  const calendarDismissLayer = control();
  const timeCalendar = control();
  const subsetTimeStartCalendar = control();
  const subsetTimeEndCalendar = control();
  const subsetTimeStartCalendarBtn = control();
  const subsetTimeEndCalendarBtn = control();
  const timeCalendarBtn = control();
  const ui = createTimeUiController({
    state: { times },
    timeCalendar,
    timeCalendarBtn,
    calendarDismissLayer,
    subsetTimeStartCalendar,
    subsetTimeEndCalendar,
    subsetTimeStartCalendarBtn,
    subsetTimeEndCalendarBtn,
    subsetTimeStart,
    subsetTimeEnd,
    parseHelpers: { formatDailyLabel: (time) => time },
  });
  return {
    ui,
    subsetTimeStart,
    subsetTimeEnd,
    calendarDismissLayer,
    timeCalendar,
    subsetTimeStartCalendar,
    subsetTimeEndCalendar,
    subsetTimeStartCalendarBtn,
    subsetTimeEndCalendarBtn,
  };
}

test("selecting either subset date closes the blocking calendar layer", () => {
  const times = ["1945-01-01", "1945-01-02", "1945-01-03"];
  const context = controller(times);
  for (const [boundary, index, input] of [
    ["start", 1, context.subsetTimeStart],
    ["end", 2, context.subsetTimeEnd],
  ]) {
    context.calendarDismissLayer.hidden = false;
    context.subsetTimeStartCalendar.hidden = false;
    context.subsetTimeEndCalendar.hidden = false;
    context.ui.applySubsetTimeCalendarSelection(boundary, index);
    assert.equal(input.value, times[index]);
    assert.equal(context.calendarDismissLayer.hidden, true);
    assert.equal(context.subsetTimeStartCalendar.hidden, true);
    assert.equal(context.subsetTimeEndCalendar.hidden, true);
    assert.equal(context.subsetTimeStartCalendarBtn.attributes["aria-expanded"], "false");
    assert.equal(context.subsetTimeEndCalendarBtn.attributes["aria-expanded"], "false");
  }
});

test("moving Start past End adjusts End without an undefined-index error", () => {
  const times = ["1945-01-01", "1945-01-02", "1945-01-03", "1945-01-04", "1945-01-05"];
  const context = controller(times);
  context.subsetTimeStart.value = times[2];
  context.subsetTimeEnd.value = times[0];
  const adjustment = context.ui.adjustSubsetEndForStart();
  assert.equal(adjustment.value, times[3]);
  assert.equal(adjustment.isFinalTimestep, false);
  assert.equal(context.subsetTimeEnd.value, times[3]);

  context.subsetTimeStart.value = times[4];
  context.subsetTimeEnd.value = times[0];
  assert.equal(context.ui.adjustSubsetEndForStart().isFinalTimestep, true);
});
