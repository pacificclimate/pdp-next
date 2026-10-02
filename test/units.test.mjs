import assert from "node:assert/strict";
import { test } from "vitest";

import { formatDisplayUnits } from "../viewer/js/core/units.js";

test("daily water units share one display label", () => {
  for (const units of ["kg m-2 d-1", "mm/day", "mm day-1", "mm d-1"]) {
    assert.equal(formatDisplayUnits(units), "mm/day");
  }
});

test("known legacy unit labels are plain text and unknown units stay intact", () => {
  assert.equal(formatDisplayUnits("celsius"), "°C");
  assert.equal(formatDisplayUnits("degrees_C"), "°C");
  assert.equal(formatDisplayUnits("meters s-1"), "m/s");
  assert.equal(formatDisplayUnits("kg m-2"), "kg/m²");
  assert.equal(formatDisplayUnits("1"), "fraction");
  assert.equal(formatDisplayUnits("kg m-2 s-1"), "kg m-2 s-1");
});
