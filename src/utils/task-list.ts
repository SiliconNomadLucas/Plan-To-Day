import type { Task, TaskStatus } from "../models/Task";
import { extractLocalDate } from "./recurrence";

export function filterTasksByStatus(
  tasks: Task[],
  status: "all" | "completed" | TaskStatus,
): Task[] {
  if (status === "all") return tasks;
  if (status === "completed") return tasks.filter((task) => task.isCompleted);
  if (status === "shelved") return tasks.filter((task) => task.status === "shelved");
  if (status === "abandoned") return tasks.filter((task) => task.status === "abandoned");
  return tasks.filter((task) => !task.isCompleted && task.status === "active");
}

/**
 * Keep generated future instances for schedules, but only expose the next
 * pending instance in a task list once its earlier instances are complete.
 */
export function hideFutureRecurrenceInstances(tasks: Task[], today: string): Task[] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.recurrenceGroupId && !task.isRecurrenceSource && task.dueDate) {
      const group = groups.get(task.recurrenceGroupId) || [];
      group.push(task);
      groups.set(task.recurrenceGroupId, group);
    }
  }

  const showNextFuture = new Set<string>();
  for (const group of groups.values()) {
    const pendingCurrentOrPast = group.some((task) =>
      extractLocalDate(task.dueDate!) <= today && !task.isCompleted,
    );
    if (pendingCurrentOrPast) continue;
    const next = group
      .filter((task) => extractLocalDate(task.dueDate!) > today && !task.isCompleted)
      .sort((a, b) => extractLocalDate(a.dueDate!).localeCompare(extractLocalDate(b.dueDate!)))[0];
    if (next) showNextFuture.add(next.id);
  }

  return tasks.filter((task) => {
    if (!task.recurrenceGroupId || task.isRecurrenceSource || !task.dueDate) return true;
    return extractLocalDate(task.dueDate) <= today || showNextFuture.has(task.id);
  });
}
