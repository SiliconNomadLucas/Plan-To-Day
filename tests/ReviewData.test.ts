import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import {
  buildMonthlyReviewTrend,
  buildTagDistribution,
  buildWeeklyReviewTrend,
} from "../src/utils/review-data";

const tags = [
  { id: "q1", name: "重要紧急", color: "#f00", sortOrder: 0 },
  { id: "work", name: "事业", color: "#0f0", sortOrder: 4 },
];

describe("review data utilities", () => {
  it("groups tasks into tag distributions and keeps empty categories", () => {
    const tasks = [
      createTask({ tags: ["q1"], isCompleted: true }),
      createTask({ tags: ["work"] }),
      createTask({ tags: [] }),
    ];
    expect(buildTagDistribution(tasks, tags, "quadrant")).toEqual([
      { name: "重要紧急", total: 1, completed: 1, color: "#BC6F67" },
      { name: "未分类", total: 2, completed: 0, color: "#71747A" },
    ]);
    expect(buildTagDistribution(tasks, tags, "domain")).toEqual([
      { name: "事业", total: 1, completed: 0, color: "#0f0" },
      { name: "未分类", total: 2, completed: 1, color: "#71747A" },
    ]);
  });

  it("groups daily data by ISO week", () => {
    const trend = buildWeeklyReviewTrend([
      { date: "2020-12-31", count: 2, uncompleted: 1 },
      { date: "2021-01-01", count: 3, uncompleted: 0 },
      { date: "2021-01-04", count: 1, uncompleted: 2 },
    ], false);
    expect(trend).toEqual([
      { label: "第53周", completed: 5, uncompleted: 1 },
      { label: "第1周", completed: 1, uncompleted: 2 },
    ]);
  });

  it("builds all twelve monthly buckets", () => {
    const trend = buildMonthlyReviewTrend([
      { date: "2026-01-03", count: 2, uncompleted: 1 },
      { date: "2026-12-31", count: 4, uncompleted: 3 },
    ], 2026, false);
    expect(trend).toHaveLength(12);
    expect(trend[0]).toEqual({ label: "1月", completed: 2, uncompleted: 1 });
    expect(trend[11]).toEqual({ label: "12月", completed: 4, uncompleted: 3 });
  });
});
