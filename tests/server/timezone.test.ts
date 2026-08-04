import { describe, expect, it } from "vitest";
import {
  getInstantForHourInTimezone,
  getLocalTimeInTimezone,
} from "../../src/server/timezone.js";

describe("timezone utilities", () => {
  it("reads Madrid hour and minute from an absolute instant", () => {
    const local = getLocalTimeInTimezone(
      new Date("2026-08-03T18:34:02Z"),
      "Europe/Madrid",
    );

    expect(local).toMatchObject({
      year: 2026,
      month: 8,
      day: 3,
      hour: 20,
      minute: 34,
    });
  });

  it("resolves a Madrid wall-clock time without depending on host timezone", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";

    try {
      const instant = getInstantForHourInTimezone(
        new Date("2026-08-03T12:00:00Z"),
        20,
        34,
        "Europe/Madrid",
      );

      expect(instant.toISOString()).toBe("2026-08-03T18:34:00.000Z");
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it("uses the configured timezone's local date when it differs from UTC", () => {
    const instant = getInstantForHourInTimezone(
      new Date("2026-08-03T12:00:00Z"),
      20,
      34,
      "America/Los_Angeles",
    );

    expect(instant.toISOString()).toBe("2026-08-04T03:34:00.000Z");
  });

  it("rejects a nonexistent local time during the spring DST transition", () => {
    expect(() => getInstantForHourInTimezone(
      new Date("2026-03-29T12:00:00Z"),
      2,
      30,
      "Europe/Madrid",
    )).toThrow(/does not exist/);
  });
});
