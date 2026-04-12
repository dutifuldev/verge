import { describe, expect, it } from "vitest";

import { statusTone } from "./App.js";

describe("statusTone", () => {
  it("maps successful states to the good tone", () => {
    expect(statusTone("passed")).toBe("good");
    expect(statusTone("fresh")).toBe("good");
  });

  it("maps failed states to the bad tone", () => {
    expect(statusTone("failed")).toBe("bad");
    expect(statusTone("stale")).toBe("bad");
  });
});
