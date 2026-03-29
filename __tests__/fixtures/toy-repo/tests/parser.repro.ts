import assert from "node:assert/strict";
import test from "node:test";

import { parseHeader } from "../src/parser";

test("empty input returns no segments instead of crashing", () => {
  assert.deepEqual(parseHeader(""), []);
});
