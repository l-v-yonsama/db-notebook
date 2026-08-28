import { describe, expect, it } from "vitest";
import { formatUtcWithLocal } from "../../src/shared/dateTimeDisplay";

describe("formatUtcWithLocal", () => {
  it("shows only local HH:mm when the local calendar date matches UTC", () => {
    expect(formatUtcWithLocal("2026-08-27T00:56:57.659Z", "Asia/Tokyo")).toBe(
      "2026-08-27T00:56:57.659Z (local 09:56)",
    );
  });

  it("adds MM-DD when local time crosses into another date", () => {
    expect(formatUtcWithLocal("2026-08-27T18:30:00.000Z", "Asia/Tokyo")).toBe(
      "2026-08-27T18:30:00.000Z (local 08-28 03:30)",
    );
  });

  it("leaves an invalid timestamp unchanged", () => {
    expect(formatUtcWithLocal("unknown", "Asia/Tokyo")).toBe("unknown");
  });
});
