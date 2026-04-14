import { describe, expect, it } from "vitest";

import { formatDuration, statusTone } from "./lib/format.js";

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

describe("formatDuration", () => {
  it("falls back to live elapsed time when durationMs is null", () => {
    const startedAt = new Date(Date.now() - 4_200).toISOString();
    expect(formatDuration(startedAt, null, null)).toBe("4s");
  });

  it("prefers the stored duration when it exists", () => {
    expect(formatDuration(null, null, 65_000)).toBe("1m 5s");
  });
});
