/**
 * Smoke tests — confirm the package imports cleanly with the right
 * public surface. These run first in CI; if they fail the package is
 * broken at the most fundamental level.
 */

import { describe, expect, it } from "vitest";

import * as ocrqueen from "../src/index.js";

describe("package surface", () => {
  it("imports without side effects", () => {
    expect(ocrqueen).toBeDefined();
  });

  it("exports VERSION as a semver-shaped string", () => {
    expect(typeof ocrqueen.VERSION).toBe("string");
    expect(ocrqueen.VERSION.split(".").length).toBeGreaterThanOrEqual(2);
  });
});
