import type { Task } from "../models/Task";
import { extractLocalDate } from "./recurrence";

export function summarizeGoalPeriod(
  tasks: Task[],
  kind: "year" | "month",
  periodKey: string,
  today: string,
) {
  const goals = tasks.filter((task) =>
    task.planKind === kind
    && task.planPeriodKey === periodKey
    && !task.isDeleted
    && !task.isRecurrenceTemplate,
  );
  const completed = goals.filter((task) => task.isCompleted).length;
  const inProgress = goals.filter((task) => !task.isCompleted && task.status === "active").length;
  const shelved = goals.filter((task) => !task.isCompleted && task.status === "shelved").length;
  const abandoned = goals.filter((task) => !task.isCompleted && task.status === "abandoned").length;
  const overdue = goals.filter((task) =>
    !task.isCompleted
    && task.status === "active"
    && task.dueDate
    && extractLocalDate(task.dueDate) < today,
  ).length;
  const denominator = completed + inProgress;
  return {
    total: goals.length,
    completed,
    inProgress,
    shelved,
    abandoned,
    overdue,
    completionRate: denominator === 0 ? 0 : Math.round((completed / denominator) * 100),
  };
}

export function shiftGoalPeriodKey(kind: "year" | "month", key: string, delta: number): string {
  if (kind === "year") return String(Math.max(2000, parseInt(key, 10) + delta));

  const [yearPart, monthPart] = key.split("-");
  let year = parseInt(yearPart, 10);
  let month = parseInt(monthPart, 10) + delta;
  if (month < 1) {
    year -= 1;
    month = 12;
  } else if (month > 12) {
    year += 1;
    month = 1;
  }
  return Math.max(2000, year) + "-" + String(month).padStart(2, "0");
}
