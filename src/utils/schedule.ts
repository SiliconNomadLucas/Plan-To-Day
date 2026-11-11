import type { Task } from "../models/Task";

export interface ScheduledTaskLayout {
  task: Task;
  col: number;
  totalCols: number;
}

export interface ScheduleVisibilitySettings {
  showDailyRecurringInDaySchedule: boolean;
  showDailyRecurringInWeekSchedule: boolean;
  showDailyRecurringInMonthSchedule: boolean;
}

interface PositionedTask {
  task: Task;
  start: number;
  end: number;
  col: number;
}

/**
 * Assigns stable columns to overlapping timed tasks.
 * Tasks without both dates are ignored because they cannot be placed on a timeline.
 */
export function layoutOverlappingTasks(tasks: Task[]): ScheduledTaskLayout[] {
  if (tasks.length === 0) return [];

  const columns: number[] = [];
  const positioned: PositionedTask[] = tasks
    .filter((task) => task.startDate !== null && task.dueDate !== null)
    .map((task) => ({
      task,
      start: new Date(task.startDate!).getTime(),
      end: new Date(task.dueDate!).getTime(),
      col: -1,
    }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  for (const item of positioned) {
    let col = columns.findIndex((endTime) => endTime <= item.start);
    if (col === -1) {
      col = columns.length;
      columns.push(0);
    }
    columns[col] = item.end;
    item.col = col;
  }

  const groups: PositionedTask[][] = [];
  let currentGroup: PositionedTask[] = [];
  let groupMaxEnd = 0;
  for (const item of positioned) {
    if (currentGroup.length === 0 || item.start < groupMaxEnd) {
      currentGroup.push(item);
      groupMaxEnd = Math.max(groupMaxEnd, item.end);
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
      groupMaxEnd = item.end;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  return groups.flatMap((group) => {
    const totalCols = Math.max(...group.map((item) => item.col)) + 1;
    return group.map((item) => ({ task: item.task, col: item.col, totalCols }));
  });
}

export function isAllDayTask(task: Task): boolean {
  if (task.myDayGroup && task.myDayGroup !== "allday") return false;
  if (task.myDayGroup === "allday" && task.startDate && task.dueDate) {
    const start = new Date(task.startDate);
    const due = new Date(task.dueDate);
    if (Number.isFinite(start.getTime()) && Number.isFinite(due.getTime())) {
      const allDayStart = start.getHours() === 7 && start.getMinutes() === 0;
      const allDayDue = due.getHours() === 23 && (due.getMinutes() === 30 || due.getMinutes() === 59);
      return allDayStart && allDayDue;
    }
  }
  if (task.myDayGroup === "allday") return true;
  if (!task.startDate && !task.dueDate) return true;
  if (task.dueDate && !task.startDate) {
    const due = new Date(task.dueDate);
    if (!Number.isFinite(due.getTime())) return true;
    return due.getHours() === 23 && (due.getMinutes() === 59 || due.getMinutes() === 30);
  }
  if (task.dueDate) {
    const dueHasTime = task.dueDate.includes("T")
      && !task.dueDate.endsWith("T00:00:00")
      && !task.dueDate.endsWith("T23:30:00")
      && !task.dueDate.endsWith("T07:00:00");
    if (!dueHasTime) return true;
  }
  return false;
}

export function isVisibleInSchedule(
  task: Task,
  view: "day" | "week" | "month",
  settings: ScheduleVisibilitySettings,
): boolean {
  if (task.recurrence !== "daily") return true;
  if (view === "day") return settings.showDailyRecurringInDaySchedule;
  if (view === "week") return settings.showDailyRecurringInWeekSchedule;
  return settings.showDailyRecurringInMonthSchedule;
}
