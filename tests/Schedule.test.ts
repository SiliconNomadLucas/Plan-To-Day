import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import { isAllDayTask, isVisibleInSchedule, layoutOverlappingTasks } from "../src/utils/schedule";

describe("schedule utilities", () => {
  it("assigns separate columns to overlapping tasks", () => {
    const first = createTask({
      id: "first",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T11:00:00",
    });
    const second = createTask({
      id: "second",
      startDate: "2026-11-09T10:00:00",
      dueDate: "2026-11-09T12:00:00",
    });

    expect(layoutOverlappingTasks([first, second])).toEqual([
      { task: first, col: 0, totalCols: 2 },
      { task: second, col: 1, totalCols: 2 },
    ]);
  });

  it("reuses columns after an earlier task ends", () => {
    const first = createTask({
      id: "first",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    const second = createTask({
      id: "second",
      startDate: "2026-11-09T10:00:00",
      dueDate: "2026-11-09T11:00:00",
    });

    expect(layoutOverlappingTasks([first, second])).toEqual([
      { task: first, col: 0, totalCols: 1 },
      { task: second, col: 0, totalCols: 1 },
    ]);
  });

  it("ignores tasks without valid timeline dates", () => {
    const undated = createTask({ id: "undated" });
    const invalid = createTask({
      id: "invalid",
      startDate: "not-a-date",
      dueDate: "2026-11-09T11:00:00",
    });

    expect(layoutOverlappingTasks([undated, invalid])).toEqual([]);
  });

  it("recognizes all-day task time boundaries", () => {
    expect(isAllDayTask(createTask({ myDayGroup: "allday", startDate: "2026-11-09T07:00:00", dueDate: "2026-11-09T23:30:00" }))).toBe(true);
    expect(isAllDayTask(createTask({ myDayGroup: "allday", startDate: "2026-11-09T07:00:00", dueDate: "2026-11-09T23:59:00" }))).toBe(true);
    expect(isAllDayTask(createTask({ myDayGroup: "morning", startDate: "2026-11-09T07:00:00", dueDate: "2026-11-09T08:00:00" }))).toBe(false);
    expect(isAllDayTask(createTask({ myDayGroup: "morning", dueDate: "2026-11-09T12:00:00" }))).toBe(false);
  });

  it("applies daily recurring visibility settings per schedule mode", () => {
    const task = createTask({ recurrence: "daily" });
    const settings = {
      showDailyRecurringInDaySchedule: true,
      showDailyRecurringInWeekSchedule: false,
      showDailyRecurringInMonthSchedule: true,
    };
    expect(isVisibleInSchedule(task, "day", settings)).toBe(true);
    expect(isVisibleInSchedule(task, "week", settings)).toBe(false);
    expect(isVisibleInSchedule(task, "month", settings)).toBe(true);
    expect(isVisibleInSchedule(createTask({ recurrence: "weekly" }), "week", settings)).toBe(true);
  });
});
