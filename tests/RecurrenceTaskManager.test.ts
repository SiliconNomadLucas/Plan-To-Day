import { describe, expect, it } from "vitest";
import { createTask, type Task } from "../src/models/Task";
import { RecurrenceTaskManager } from "../src/services/RecurrenceTaskManager";

function createManager(tasks: Task[]) {
  let saves = 0;
  const manager = new RecurrenceTaskManager(
    () => tasks,
    (next) => {
      tasks.splice(0, tasks.length, ...next);
    },
    async () => {
      saves++;
    },
  );
  return { manager, getSaveCount: () => saves };
}

describe("RecurrenceTaskManager", () => {
  it("turns a task into a recurrence template and creates future instances", async () => {
    const tasks = [createTask({
      id: "source",
      title: "Daily review",
      startDate: "2099-01-01T09:00:00",
      dueDate: "2099-01-01T10:00:00",
    })];
    const { manager, getSaveCount } = createManager(tasks);

    await manager.setRecurrence("source", "daily");

    const source = tasks.find((task) => task.id === "source")!;
    const instances = tasks.filter((task) => task.recurrenceGroupId === source.recurrenceGroupId && !task.isRecurrenceTemplate);
    expect(source.isRecurrenceTemplate).toBe(true);
    expect(source.isRecurrenceSource).toBe(true);
    expect(instances.length).toBeGreaterThan(1);
    expect(instances[0].dueDate).toContain("T10:00:00");
    expect(getSaveCount()).toBe(1);
  });

  it("syncs future instance properties without changing completed history", async () => {
    const source = createTask({
      id: "source",
      recurrence: "daily",
      recurrenceGroupId: "group",
      isRecurrenceSource: true,
      isRecurrenceTemplate: true,
      dueDate: "2099-01-01T10:00:00",
      startDate: "2099-01-01T09:00:00",
    });
    const current = createTask({
      id: "current",
      recurrence: "daily",
      recurrenceGroupId: "group",
      dueDate: "2099-01-01T10:00:00",
      startDate: "2099-01-01T09:00:00",
    });
    const future = createTask({
      id: "future",
      recurrence: "daily",
      recurrenceGroupId: "group",
      dueDate: "2099-01-02T10:00:00",
      startDate: "2099-01-02T09:00:00",
    });
    const completed = createTask({
      id: "completed",
      recurrence: "daily",
      recurrenceGroupId: "group",
      dueDate: "2099-01-03T10:00:00",
      startDate: "2099-01-03T09:00:00",
      isCompleted: true,
      title: "Old title",
    });
    const tasks = [source, current, future, completed];
    const { manager } = createManager(tasks);

    await manager.syncProperties("current", { title: "Updated" });

    expect(future.title).toBe("Updated");
    expect(completed.title).toBe("Old title");
  });
});
