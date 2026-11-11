import type { Task } from "../models/Task";
import { getISOWeekNumber, getISOWeekYear } from "./period";

export interface ReviewTag {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  isDefault?: boolean;
}

export interface ReviewDistribution {
  name: string;
  total: number;
  completed: number;
  color: string;
}

export interface ReviewTrendPoint {
  label: string;
  completed: number;
  uncompleted: number;
}

const UNCATEGORIZED = "未分类";
const DEFAULT_COLOR = "#71747A";
const QUADRANT_COLORS: Record<string, string> = {
  "重要紧急": "#BC6F67",
  "重要不紧急": "#6D91B6",
  "不重要紧急": "#C19957",
  "不重要不紧急": "#9AA1A1",
};

export function buildTagDistribution(
  tasks: Task[],
  tags: ReviewTag[],
  kind: "quadrant" | "domain",
): ReviewDistribution[] {
  const matchingTags = tags.filter((tag) => kind === "quadrant" ? tag.sortOrder < 4 : tag.sortOrder >= 4);
  const groups = new Map<string, ReviewDistribution>();
  for (const tag of matchingTags) {
    groups.set(tag.name, {
      name: tag.name,
      total: 0,
      completed: 0,
      color: kind === "quadrant" ? (QUADRANT_COLORS[tag.name] || DEFAULT_COLOR) : tag.color,
    });
  }
  groups.set(UNCATEGORIZED, { name: UNCATEGORIZED, total: 0, completed: 0, color: DEFAULT_COLOR });

  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  for (const task of tasks) {
    const tag = task.tags
      .map((tagId) => tagById.get(tagId))
      .find((candidate) => candidate && (kind === "quadrant" ? candidate.sortOrder < 4 : candidate.sortOrder >= 4));
    const group = groups.get(tag?.name || UNCATEGORIZED)!;
    group.total++;
    if (task.isCompleted) group.completed++;
  }
  return [...groups.values()];
}

export function buildWeeklyReviewTrend(
  dailyTrend: Array<{ date: string; count: number; uncompleted: number }>,
  english: boolean,
): ReviewTrendPoint[] {
  const groups = new Map<string, { week: number; completed: number; uncompleted: number }>();
  for (const item of dailyTrend) {
    const date = new Date(`${item.date}T00:00:00`);
    const weekYear = getISOWeekYear(date);
    const week = getISOWeekNumber(date);
    const key = `${weekYear}-W${String(week).padStart(2, "0")}`;
    const current = groups.get(key) || { week, completed: 0, uncompleted: 0 };
    current.completed += item.count;
    current.uncompleted += item.uncompleted;
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, value]) => ({
    label: english ? `Week ${value.week}` : `第${value.week}周`,
    completed: value.completed,
    uncompleted: value.uncompleted,
  }));
}

export function buildMonthlyReviewTrend(
  dailyTrend: Array<{ date: string; count: number; uncompleted: number }>,
  year: number,
  english: boolean,
): ReviewTrendPoint[] {
  const totals = Array.from({ length: 12 }, () => ({ completed: 0, uncompleted: 0 }));
  for (const item of dailyTrend) {
    const date = new Date(`${item.date}T00:00:00`);
    if (date.getFullYear() !== year) continue;
    const month = date.getMonth();
    totals[month].completed += item.count;
    totals[month].uncompleted += item.uncompleted;
  }

  return totals.map((value, index) => ({
    label: english
      ? new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, index, 1))
      : `${index + 1}月`,
    ...value,
  }));
}
