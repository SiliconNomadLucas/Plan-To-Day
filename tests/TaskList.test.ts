import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import { filterTasksByStatus, hideFutureRecurrenceInstances } from "../src/utils/task-list";

describe("task list selection", () => {
  it("preserves the status-filter semantics for completed and paused tasks", () => {
    const active = createTask({ id: "active" });
    const completed = createTask({ id: "completed", isCompleted: true });
    const shelved = createTask({ id: "shelved", status: "shelved" });
    const abandoned = createTask({ id: "abandoned", status: "abandoned" });
    const tasks = [active, completed, shelved, abandoned];

    expect(filterTasksByStatus(tasks, "active").map((task) => task.id)).toEqual(["active"]);
    expect(filterTasksByStatus(tasks, "completed").map((task) => task.id)).toEqual(["completed"]);
    expect(filterTasksByStatus(tasks, "shelved").map((task) => task.id)).toEqual(["shelved"]);
    expect(filterTasksByStatus(tasks, "abandoned").map((task) => task.id)).toEqual(["abandoned"]);
    expect(filterTasksByStatus(tasks, "all")).toBe(tasks);
  });

  it("hides future instances while an earlier instance is pending", () => {
    const pending = createTask({
      id: "pending",
      recurrenceGroupId: "series",
      dueDate: "2026-11-09T09:00:00",
    });
    const tomorrow = createTask({
      id: "tomorrow",
      recurrenceGroupId: "series",
      dueDate: "2026-11-11T09:00:00",
    });
    const later = createTask({
      id: "later",
      recurrenceGroupId: "series",
      dueDate: "2026-11-12T09:00:00",
    });
    const ordinary = createTask({ id: "ordinary", dueDate: "2026-11-12T09:00:00" });
    const tasks = [later, ordinary, pending, tomorrow];

    expect(hideFutureRecurrenceInstances(tasks, "2026-11-10").map((task) => task.id))
      .toEqual(["ordinary", "pending"]);
    pending.isCompleted = true;
    expect(hideFutureRecurrenceInstances(tasks, "2026-11-10").map((task) => task.id))
      .toEqual(["ordinary", "pending", "tomorrow"]);
    expect(tasks.map((task) => task.id)).toEqual(["later", "ordinary", "pending", "tomorrow"]);
  });
});
