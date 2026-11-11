import { describe, expect, it } from "vitest";
import {
  extractLocalDate,
  formatRecurrenceDisplay,
  getNextOccurrenceDate,
  getPreGenerateCount,
} from "../src/utils/recurrence";

describe("recurrence utilities", () => {
  it("clamps monthly recurrence to the last day of the month", () => {
    const next = getNextOccurrenceDate(new Date(2024, 0, 31), "monthly");
    expect(next.getFullYear()).toBe(2024);
    expect(next.getMonth()).toBe(1);
    expect(next.getDate()).toBe(29);
  });

  it("supports custom recurrence intervals", () => {
    const next = getNextOccurrenceDate(new Date(2024, 0, 1), "custom:2:week");
    expect(next.getFullYear()).toBe(2024);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(15);
    expect(getPreGenerateCount("custom:2:week")).toBe(4);
  });

  it("extracts the intended local date from local and UTC timestamps", () => {
    expect(extractLocalDate("2026-09-14T06:00:00")).toBe("2026-09-14");
    expect(extractLocalDate("2026-09-13T20:00:00Z")).toBe("2026-09-13");
  });

  it("formats recurrence rules for display", () => {
    expect(formatRecurrenceDisplay("daily")).toBe("每天");
    expect(formatRecurrenceDisplay("custom:3:month")).toBe("每3月");
  });
});
