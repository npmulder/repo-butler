import assert from "node:assert/strict";
import test from "node:test";

import { parseHeader } from "../src/parser";

test("colon-delimited input is split into trimmed segments", () => {
  assert.deepEqual(parseHeader(" alpha : beta "), ["alpha", "beta"]);
});
