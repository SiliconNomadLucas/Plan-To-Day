import { describe, expect, it } from "vitest";
import {
  ageFromDueDate,
  getISOWeekNumber,
  getISOWeekRange,
  getISOWeekYear,
  getParentPeriodKey,
  getPeriodKeyForDate,
} from "../src/utils/period";

describe("period utilities", () => {
  it("uses ISO week year at year boundaries", () => {
    const newYear = new Date(2021, 0, 1);
    expect(getISOWeekYear(newYear)).toBe(2020);
    expect(getISOWeekNumber(newYear)).toBe(53);
    expect(getPeriodKeyForDate(newYear, "week")).toBe("2020-W53");
  });

  it("returns a Monday-to-Sunday ISO week range", () => {
    const range = getISOWeekRange(2020, 53);
    expect(range.start.getFullYear()).toBe(2020);
    expect(range.start.getMonth()).toBe(11);
    expect(range.start.getDate()).toBe(28);
    expect(range.end.getFullYear()).toBe(2021);
    expect(range.end.getMonth()).toBe(0);
    expect(range.end.getDate()).toBe(3);
  });

  it("maps a week to the month containing its Monday", () => {
    expect(getParentPeriodKey("week", "2021-W01")).toBe("2021-01");
  });

  it("calculates age using the due date boundary", () => {
    expect(ageFromDueDate("2000-02-29", "2024-02-28")).toBe(23);
    expect(ageFromDueDate("2000-02-29", "2024-02-29")).toBe(24);
  });
});
