import { describe, expect, it } from "vitest";
import {
  formatReviewTitle,
  getReviewRange,
  normalizeReviewDate,
  reviewDateToString,
  shiftReviewDate,
} from "../src/utils/review";

describe("review utilities", () => {
  it("normalizes dates across month boundaries", () => {
    expect(normalizeReviewDate({ year: 2026, month: 1, date: 31 })).toEqual({
      year: 2026,
      month: 2,
      date: 3,
    });
  });

  it("shifts review dates by the selected mode", () => {
    const state = { year: 2026, month: 0, date: 1 };
    expect(shiftReviewDate(state, "day", -1)).toEqual({ year: 2025, month: 11, date: 31 });
    expect(shiftReviewDate(state, "week", 1)).toEqual({ year: 2026, month: 0, date: 8 });
    expect(shiftReviewDate(state, "month", 1)).toEqual({ year: 2026, month: 1, date: 1 });
    expect(shiftReviewDate(state, "year", 1)).toEqual({ year: 2027, month: 0, date: 1 });
  });

  it("uses the ISO year for a week crossing New Year", () => {
    const state = { year: 2021, month: 0, date: 1 };
    expect(getReviewRange(state, "week")).toMatchObject({
      start: "2020-12-28",
      end: "2021-01-03",
      weekYear: 2020,
      week: 53,
    });
    expect(formatReviewTitle(state, "week", false)).toBe("2020年第53周 (12.28 - 1.3)");
  });

  it("formats a review date for service queries", () => {
    expect(reviewDateToString({ year: 2026, month: 10, date: 9 })).toBe("2026-11-09");
    expect(getReviewRange({ year: 2026, month: 1, date: 1 }, "month")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });
});
