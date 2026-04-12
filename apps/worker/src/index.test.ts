import { describe, expect, it } from "vitest";

import { normalizeObservationAreaKeys } from "./index.js";

describe("normalizeObservationAreaKeys", () => {
  it("preserves explicit area keys", () => {
    expect(normalizeObservationAreaKeys(["api", "packages"])).toEqual(["api", "packages"]);
  });

  it("creates a run-level observation marker when no areas are provided", () => {
    expect(normalizeObservationAreaKeys([])).toEqual([null]);
  });
});
