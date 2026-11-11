import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import { shiftGoalPeriodKey, summarizeGoalPeriod } from "../src/utils/goal-dashboard";

describe("goal dashboard calculations", () => {
  it("counts lifecycle states and overdue active goals without changing the completion denominator", () => {
    const tasks = [
      createTask({ planKind: "month", planPeriodKey: "2026-11", isCompleted: true }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", status: "active" }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", status: "active", dueDate: "2026-11-01T12:00:00" }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", status: "shelved" }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", status: "abandoned" }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", isDeleted: true }),
      createTask({ planKind: "month", planPeriodKey: "2026-11", isRecurrenceTemplate: true }),
      createTask({ planKind: "month", planPeriodKey: "2026-10" }),
    ];

    expect(summarizeGoalPeriod(tasks, "month", "2026-11", "2026-11-10")).toEqual({
      total: 5,
      completed: 1,
      inProgress: 2,
      shelved: 1,
      abandoned: 1,
      overdue: 1,
      completionRate: 33,
    });
  });

  it("moves across month and year boundaries and retains the existing lower bound", () => {
    expect(shiftGoalPeriodKey("month", "2026-12", 1)).toBe("2027-01");
    expect(shiftGoalPeriodKey("month", "2026-01", -1)).toBe("2025-12");
    expect(shiftGoalPeriodKey("month", "2000-01", -1)).toBe("2000-12");
    expect(shiftGoalPeriodKey("year", "2000", -1)).toBe("2000");
  });
});
