import type { Task, TaskStatus } from "../models/Task";

export interface PersistedTask extends Omit<
  Task,
  | "isDeleted"
  | "deletedAt"
  | "recurrenceGroupId"
  | "isRecurrenceTemplate"
  | "isRecurrenceSource"
  | "recurrenceEndDate"
  | "status"
> {
  isDeleted?: boolean;
  deletedAt?: string | null;
  recurrenceGroupId?: string | null;
  isRecurrenceTemplate?: boolean;
  isRecurrenceSource?: boolean;
  recurrenceEndDate?: string | null;
  status?: TaskStatus;
  myDayDate?: string | null;
  isMyDay?: boolean;
}

export interface VersionedTaskDatabase {
  schemaVersion?: number;
  tasks: PersistedTask[];
}

export interface TaskDatabaseMigrationResult {
  schemaVersion: number;
  tasks: Task[];
  changed: boolean;
}

export const CURRENT_TASK_SCHEMA_VERSION = 4;

type Migration = (tasks: PersistedTask[]) => PersistedTask[];

const MIGRATIONS: Record<number, Migration> = {
  0: migrateSoftDeleteAndRecurrenceFields,
  1: migrateTaskStatus,
  2: migrateLegacyMyDayFields,
  3: repairLegacyRecurrenceDates,
};

export function migrateTaskDatabase(value: unknown): TaskDatabaseMigrationResult {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !value.tasks.every(isPersistedTask)) {
    throw new Error("Invalid task database: expected a tasks array.");
  }

  const rawVersion = value.schemaVersion;
  const sourceVersion = rawVersion === undefined ? 0 : rawVersion;
  if (typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion) || sourceVersion < 0) {
    throw new Error(`Invalid task database schema version: ${sourceVersion}.`);
  }
  if (sourceVersion > CURRENT_TASK_SCHEMA_VERSION) {
    throw new Error(
      `Task database schema version ${sourceVersion} is newer than supported version ${CURRENT_TASK_SCHEMA_VERSION}.`,
    );
  }

  let tasks = value.tasks.map((task) => ({ ...task }));
  let schemaVersion = sourceVersion;
  while (schemaVersion < CURRENT_TASK_SCHEMA_VERSION) {
    const migration = MIGRATIONS[schemaVersion];
    if (!migration) throw new Error(`Missing task database migration from version ${schemaVersion}.`);
    tasks = migration(tasks);
    schemaVersion++;
  }

  return {
    schemaVersion,
    tasks: tasks.map(({ myDayDate: _myDayDate, isMyDay: _isMyDay, ...task }) => ({
      ...task,
      isDeleted: task.isDeleted ?? false,
      deletedAt: task.deletedAt ?? null,
      recurrenceGroupId: task.recurrenceGroupId ?? null,
      isRecurrenceTemplate: task.isRecurrenceTemplate ?? false,
      isRecurrenceSource: task.isRecurrenceSource ?? false,
      recurrenceEndDate: task.recurrenceEndDate ?? null,
      status: task.status ?? "active",
    })),
    changed: sourceVersion !== CURRENT_TASK_SCHEMA_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPersistedTask(value: unknown): value is PersistedTask {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.note === "string"
    && typeof value.isCompleted === "boolean"
    && typeof value.isImportant === "boolean"
    && ["allday", "morning", "noon", "afternoon", "evening"].includes(String(value.myDayGroup))
    && (typeof value.startDate === "string" || value.startDate === null)
    && (typeof value.dueDate === "string" || value.dueDate === null)
    && (typeof value.recurrence === "string" || value.recurrence === null)
    && typeof value.listId === "string"
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === "string")
    && Array.isArray(value.relatedPaths)
    && value.relatedPaths.every((path) => typeof path === "string")
    && Array.isArray(value.relatedFolders)
    && value.relatedFolders.every((path) => typeof path === "string")
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (typeof value.completedAt === "string" || value.completedAt === null);
}

function migrateSoftDeleteAndRecurrenceFields(tasks: PersistedTask[]): PersistedTask[] {
  return tasks.map((task) => ({
    ...task,
    isDeleted: task.isDeleted ?? false,
    deletedAt: task.deletedAt ?? null,
    recurrenceGroupId: task.recurrenceGroupId ?? null,
    isRecurrenceTemplate: task.isRecurrenceTemplate ?? false,
    isRecurrenceSource: task.isRecurrenceSource ?? false,
    recurrenceEndDate: task.recurrenceEndDate ?? null,
  }));
}

function migrateTaskStatus(tasks: PersistedTask[]): PersistedTask[] {
  return tasks.map((task) => ({ ...task, status: task.status ?? "active" }));
}

function migrateLegacyMyDayFields(tasks: PersistedTask[]): PersistedTask[] {
  return tasks.map((task) => {
    if (!task.myDayDate) return task;
    const timeOf = (value: string | null, fallback: string): string => {
      if (!value || !value.includes("T")) return fallback;
      return value.substring(value.indexOf("T"));
    };
    return {
      ...task,
      startDate: task.myDayDate + timeOf(task.startDate, "T07:00:00"),
      dueDate: task.myDayDate + timeOf(task.dueDate, "T23:30:00"),
    };
  });
}

function repairLegacyRecurrenceDates(tasks: PersistedTask[]): PersistedTask[] {
  return tasks.map((task) => {
    if (
      task.recurrenceGroupId
      && !task.isRecurrenceSource
      && !task.isRecurrenceTemplate
      && task.startDate
      && task.dueDate
      && task.startDate === task.dueDate
    ) {
      return { ...task, startDate: task.startDate.replace(/T\d{2}:\d{2}:\d{2}/, "T07:00:00") };
    }
    return task;
  });
}
