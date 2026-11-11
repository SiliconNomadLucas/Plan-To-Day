import { describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import {
  CURRENT_TASK_SCHEMA_VERSION,
  migrateTaskDatabase,
  type PersistedTask,
} from "../src/services/TaskDatabaseMigrations";

describe("task database migrations", () => {
  it("upgrades an unversioned legacy task database", () => {
    const legacyTask: PersistedTask = {
      ...createTask({
        id: "legacy",
        startDate: null,
        dueDate: null,
        recurrence: "daily",
      }),
      isDeleted: undefined,
      deletedAt: undefined,
      recurrenceGroupId: "series",
      isRecurrenceTemplate: false,
      isRecurrenceSource: false,
      recurrenceEndDate: undefined,
      status: undefined,
      myDayDate: "2024-04-05",
      isMyDay: true,
    };

    const result = migrateTaskDatabase({ tasks: [legacyTask] });
    const migrated = result.tasks[0];

    expect(result.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
    expect(result.changed).toBe(true);
    expect(migrated.isDeleted).toBe(false);
    expect(migrated.deletedAt).toBeNull();
    expect(migrated.status).toBe("active");
    expect(migrated.startDate).toBe("2024-04-05T07:00:00");
    expect(migrated.dueDate).toBe("2024-04-05T23:30:00");
    expect("myDayDate" in migrated).toBe(false);
    expect("isMyDay" in migrated).toBe(false);
  });

  it("repairs only legacy recurrence instances with identical start and due timestamps", () => {
    const instance = createTask({
      id: "instance",
      recurrenceGroupId: "series",
      startDate: "2024-04-05T10:00:00",
      dueDate: "2024-04-05T10:00:00",
    });
    const unrelated = createTask({
      id: "unrelated",
      startDate: "2024-04-05T10:00:00",
      dueDate: "2024-04-05T10:00:00",
    });

    const result = migrateTaskDatabase({ schemaVersion: 3, tasks: [instance, unrelated] });

    expect(result.tasks.find((task) => task.id === "instance")?.startDate).toBe("2024-04-05T07:00:00");
    expect(result.tasks.find((task) => task.id === "unrelated")?.startDate).toBe("2024-04-05T10:00:00");
    expect(result.changed).toBe(true);
  });

  it("continues each migration from an intermediate schema version", () => {
    const task = {
      ...createTask({
        id: "intermediate",
        status: undefined,
        recurrenceGroupId: "series",
        startDate: "2024-04-05T10:00:00",
        dueDate: "2024-04-05T10:00:00",
      }),
      status: undefined,
      myDayDate: null,
      isMyDay: true,
    };

    const result = migrateTaskDatabase({ schemaVersion: 1, tasks: [task] });

    expect(result.tasks[0].status).toBe("active");
    expect(result.tasks[0].startDate).toBe("2024-04-05T07:00:00");
    expect(result.tasks[0]).not.toHaveProperty("isMyDay");
    expect(result.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
  });

  it("is idempotent for the current schema version", () => {
    const task = createTask({ id: "current" });
    const first = migrateTaskDatabase({ schemaVersion: CURRENT_TASK_SCHEMA_VERSION, tasks: [task] });
    const second = migrateTaskDatabase({ schemaVersion: first.schemaVersion, tasks: first.tasks });

    expect(first.changed).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.tasks).toEqual(first.tasks);
  });

  it("rejects future database schemas without attempting a downgrade", () => {
    expect(() => migrateTaskDatabase({
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION + 1,
      tasks: [],
    })).toThrow(/newer than supported/);
  });

  it("rejects invalid database task collections", () => {
    expect(() => migrateTaskDatabase({ tasks: null })).toThrow(/expected a tasks array/);
    expect(() => migrateTaskDatabase({ tasks: [{}] })).toThrow(/expected a tasks array/);
  });
});
