import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import { LocalAIProvider } from "../src/services/AIRecommendationService";

const DATE = "2026-11-11";
const WEEK = "2026-W46";

describe("daily AI recommendations", () => {
  it("offers this week's plan as a regular daily task, even when its goal date is today and capacity is full", async () => {
    const weeklyGoal = createTask({
      id: "weekly-goal",
      title: "Weekly goal",
      planKind: "week",
      planPeriodKey: WEEK,
      dueDate: DATE + "T23:30:00",
    });
    const scheduledTasks = Array.from({ length: 4 }, (_, index) => createTask({
      id: `daily-${index}`,
      title: `Scheduled task ${index}`,
      dueDate: DATE + "T10:00:00",
    }));
    const otherWeekGoal = createTask({
      id: "other-week",
      title: "Other week goal",
      planKind: "week",
      planPeriodKey: "2026-W45",
    });
    const yearGoal = createTask({
      id: "year-goal",
      title: "Year goal",
      planKind: "year",
      planPeriodKey: "2026",
    });
    const monthGoal = createTask({
      id: "month-goal",
      title: "Month goal",
      planKind: "month",
      planPeriodKey: "2026-11",
    });
    const provider = new LocalAIProvider();

    const recommendations = await provider.recommendMyDay({
      tasks: [weeklyGoal, ...scheduledTasks, otherWeekGoal, yearGoal, monthGoal],
      date: DATE,
      intensity: "light",
    });

    const recommendation = recommendations.find((item) => item.parentId === weeklyGoal.id);
    expect(recommendation).toBeDefined();
    expect(recommendation?.title).toBe("Weekly goal");
    expect(recommendation).not.toHaveProperty("planKind");
    expect(recommendation).not.toHaveProperty("planPeriodKey");
    expect(recommendation?.sourceTaskId).toBeUndefined();
    expect(recommendation?.startDate).toMatch(/^2026-11-11T/);
    expect(recommendation?.warning).toContain("每日建议容量");
    expect(recommendations.some((item) => item.parentId === otherWeekGoal.id)).toBe(false);
    expect(recommendations.some((item) => item.parentId === yearGoal.id)).toBe(false);
    expect(recommendations.some((item) => item.title === monthGoal.title)).toBe(false);
  });

  it("does not recommend a weekly goal already copied into the selected day", async () => {
    const weeklyGoal = createTask({
      id: "weekly-goal",
      title: "Weekly goal",
      planKind: "week",
      planPeriodKey: WEEK,
    });
    const dailyCopy = createTask({
      id: "daily-copy",
      title: "Weekly goal",
      parentId: weeklyGoal.id,
      dueDate: DATE + "T10:00:00",
    });
    const provider = new LocalAIProvider();

    const recommendations = await provider.recommendMyDay({
      tasks: [weeklyGoal, dailyCopy],
      date: DATE,
      intensity: "balanced",
    });

    expect(recommendations).toEqual([]);
  });

  it("returns up to ten daily recommendation cards", async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => createTask({
      id: `task-${index}`,
      title: `Email task ${index}`,
      dueDate: `2026-11-${String(12 + index).padStart(2, "0")}T10:00:00`,
    }));
    const provider = new LocalAIProvider();

    const recommendations = await provider.recommendMyDay({
      tasks,
      date: DATE,
      intensity: "high",
    });

    expect(recommendations).toHaveLength(10);
  });
});
