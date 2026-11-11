import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../src/models/Task";
import { RecurrenceSeriesService } from "../src/services/RecurrenceSeriesService";
import { TaskService } from "../src/services/TaskService";
import { extractLocalDate } from "../src/utils/recurrence";

class FakeAdapter {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return {
      files: [...this.files.keys()]
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length)),
      folders: [],
    };
  }
}

class FakeVault {
  adapter = new FakeAdapter();
  folders = new Set<string>();

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  getAbstractFileByPath(path: string): { path: string } | null {
    return this.adapter.files.has(path) ? { path } : null;
  }

  async read(file: { path: string }): Promise<string> {
    return this.adapter.read(file.path);
  }

  async create(path: string, content: string): Promise<void> {
    await this.adapter.write(path, content);
  }

  async modify(file: { path: string }, content: string): Promise<void> {
    await this.adapter.write(file.path, content);
  }
}

describe("recurrence service integration", () => {
  let vault: FakeVault;
  let tasks: TaskService;
  let series: RecurrenceSeriesService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    vault = new FakeVault();
    series = new RecurrenceSeriesService(vault as never, "todo");
    await series.init();
    tasks = new TaskService(vault as never, "todo", series);
    await tasks.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a persisted series, template, current task, and future instances", async () => {
    const source = await tasks.create({
      title: "Daily review",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });

    await tasks.setRecurrence(source.id, "daily");

    const template = tasks.getSources()[0];
    const instances = tasks.getGroupInstances(template.recurrenceGroupId!);
    const persistedSeries = JSON.parse(vault.adapter.files.get("todo/recurrence-series.json")!);
    expect(template.isRecurrenceTemplate).toBe(true);
    expect(instances.length).toBeGreaterThan(1);
    expect(instances[0].dueDate).toBe("2026-11-09T10:00:00");
    expect(persistedSeries.data.series).toHaveLength(1);
    expect(persistedSeries.data.series[0].rule).toBe("daily");
  });

  it("honors the recurrence end date while generating instances", async () => {
    const source = await tasks.create({
      title: "Short series",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });

    await tasks.setRecurrence(source.id, "daily", "2026-11-11");

    const template = tasks.getSources()[0];
    const dates = tasks.getGroupInstances(template.recurrenceGroupId!)
      .map((task) => extractLocalDate(task.dueDate!));
    expect(dates).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("replenishes a depleted future window after an instance is completed", async () => {
    const source = await tasks.create({
      title: "Replenish",
      startDate: "2026-10-05T09:00:00",
      dueDate: "2026-10-05T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const before = tasks.getGroupInstances(groupId);
    const beforeDates = before.map((task) => extractLocalDate(task.dueDate!)).sort();
    const beforeLatest = beforeDates[beforeDates.length - 1];
    const firstInstance = before.find((task) => extractLocalDate(task.dueDate!) === "2026-10-05")!;

    await tasks.complete(firstInstance.id);

    const after = tasks.getGroupInstances(groupId);
    const afterDates = after.map((task) => extractLocalDate(task.dueDate!)).sort();
    const afterLatest = afterDates[afterDates.length - 1];
    expect(beforeLatest).toBe("2026-11-02");
    expect(afterLatest).toBe("2026-12-06");
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("syncs future schedule times while preserving each instance date", async () => {
    const source = await tasks.create({
      title: "Schedule sync",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const current = tasks.getGroupInstances(groupId)
      .find((task) => extractLocalDate(task.dueDate!) === "2026-11-09")!;
    const future = tasks.getGroupInstances(groupId)
      .find((task) => extractLocalDate(task.dueDate!) === "2026-11-10")!;

    const changed = await tasks.syncRecurrenceSchedule(
      current.id,
      "2026-11-09T08:15:00",
      "2026-11-09T12:30:00",
    );

    expect(changed).toBeGreaterThan(0);
    expect(future.startDate).toBe("2026-11-10T08:15:00");
    expect(future.dueDate).toBe("2026-11-10T12:30:00");
    expect(current.startDate).toBe("2026-11-09T09:00:00");
    expect(current.dueDate).toBe("2026-11-09T10:00:00");
  });

  it("syncs future properties without changing dates or completed instances", async () => {
    const source = await tasks.create({
      title: "Property sync",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
      tags: ["old"],
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const instances = tasks.getGroupInstances(groupId);
    const current = instances.find((task) => extractLocalDate(task.dueDate!) === "2026-11-09")!;
    const future = instances.find((task) => extractLocalDate(task.dueDate!) === "2026-11-10")!;
    const completedFuture = instances.find((task) => extractLocalDate(task.dueDate!) === "2026-11-11")!;
    await tasks.complete(completedFuture.id);

    const changed = await tasks.syncRecurrenceProperties(current.id, {
      title: "Renamed series",
      tags: ["new"],
      isImportant: true,
    });

    expect(changed).toBeGreaterThan(0);
    expect(future.title).toBe("Renamed series");
    expect(future.tags).toEqual(["new"]);
    expect(future.isImportant).toBe(true);
    expect(future.dueDate).toBe("2026-11-10T10:00:00");
    expect(completedFuture.title).toBe("Property sync");
    expect(completedFuture.tags).toEqual(["old"]);
  });

  it("regenerates pending instances after source dates change and keeps completed history", async () => {
    const source = await tasks.create({
      title: "Move series",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const instances = tasks.getGroupInstances(groupId);
    const completed = instances.find((item) => extractLocalDate(item.dueDate!) === "2026-11-09")!;
    await tasks.complete(completed.id);

    await tasks.update(template.id, {
      startDate: "2026-12-01T08:30:00",
      dueDate: "2026-12-01T11:00:00",
    });

    const remaining = tasks.getGroupInstances(groupId);
    expect(tasks.getById(completed.id)?.isCompleted).toBe(true);
    expect(remaining.some((item) => item.id === completed.id)).toBe(true);
    expect(remaining.filter((item) => !item.isCompleted).map((item) => item.dueDate)).toEqual([
      "2026-12-02T11:00:00",
      "2026-12-03T11:00:00",
      "2026-12-04T11:00:00",
      "2026-12-05T11:00:00",
      "2026-12-06T11:00:00",
      "2026-12-07T11:00:00",
      "2026-12-08T11:00:00",
      "2026-12-09T11:00:00",
      "2026-12-10T11:00:00",
      "2026-12-11T11:00:00",
      "2026-12-12T11:00:00",
      "2026-12-13T11:00:00",
      "2026-12-14T11:00:00",
      "2026-12-15T11:00:00",
      "2026-12-16T11:00:00",
      "2026-12-17T11:00:00",
      "2026-12-18T11:00:00",
      "2026-12-19T11:00:00",
      "2026-12-20T11:00:00",
      "2026-12-21T11:00:00",
      "2026-12-22T11:00:00",
      "2026-12-23T11:00:00",
      "2026-12-24T11:00:00",
      "2026-12-25T11:00:00",
      "2026-12-26T11:00:00",
      "2026-12-27T11:00:00",
      "2026-12-28T11:00:00",
      "2026-12-29T11:00:00",
    ]);
    expect(remaining.filter((item) => !item.isCompleted)
      .every((item) => item.startDate?.endsWith("T08:30:00"))).toBe(true);
  });

  it("changes a recurrence rule without deleting completed history", async () => {
    const source = await tasks.create({
      title: "Rule change",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const current = tasks.getGroupInstances(groupId)[0];
    await tasks.complete(current.id);
    const completedDate = extractLocalDate(current.dueDate!);

    await tasks.setRecurrence(template.id, "weekly");

    expect(tasks.getById(current.id)?.isCompleted).toBe(true);
    expect(tasks.getSources().find((item) => item.id === template.id)?.recurrence).toBe("weekly");
    expect(tasks.getGroupInstances(groupId).some((item) => item.id === current.id)).toBe(true);
    expect(tasks.getGroupInstances(groupId).every((item) =>
      item.isCompleted || extractLocalDate(item.dueDate!) === completedDate || item.recurrence === "weekly",
    )).toBe(true);
  });

  it("stops a series by removing future instances and preserving the selected task", async () => {
    const source = await tasks.create({
      title: "Stop series",
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources()[0];
    const groupId = template.recurrenceGroupId!;
    const current = tasks.getGroupInstances(groupId)[0];

    const removed = await tasks.stopRecurrence(groupId, current.id);

    expect(removed).toBeGreaterThan(0);
    expect(tasks.getById(current.id)?.recurrenceGroupId).toBeNull();
    expect(tasks.getGroupInstances(groupId).every((item) =>
      extractLocalDate(item.dueDate!) <= "2026-11-09",
    )).toBe(true);
    expect(series.get(groupId)).toBeUndefined();
  });

  it("deletes current and future series entries but keeps completed past history", async () => {
    const source = await tasks.create({
      title: "Delete series",
      startDate: "2026-11-08T09:00:00",
      dueDate: "2026-11-08T10:00:00",
    });
    await tasks.setRecurrence(source.id, "daily");
    const template = tasks.getSources().find((item) => item.id === source.id)!;
    const groupId = template.recurrenceGroupId!;
    const beforeDelete = tasks.getGroupInstances(groupId);
    const historical = beforeDelete.find((item) => extractLocalDate(item.dueDate!) === "2026-11-08")!;
    const currentAndFuture = beforeDelete.filter((item) => extractLocalDate(item.dueDate!) >= "2026-11-09");
    await tasks.complete(historical.id);

    await tasks.deleteSeries(groupId);

    expect(tasks.getById(historical.id)?.isCompleted).toBe(true);
    expect(tasks.getById(historical.id)?.isDeleted).toBe(false);
    expect(currentAndFuture.every((item) => tasks.getById(item.id)?.isDeleted)).toBe(true);
    expect(tasks.getGroupInstances(groupId).map((item) => item.id)).toEqual([historical.id]);
    expect(series.get(groupId)).toBeUndefined();
  });

  it("migrates a legacy recurrence source once and persists its series", async () => {
    const legacySource = createTask({
      id: "legacy-source",
      title: "Legacy daily",
      recurrence: "daily",
      recurrenceGroupId: "legacy-series",
      isRecurrenceSource: true,
      isRecurrenceTemplate: false,
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T10:00:00",
    });
    vault.adapter.files.set("todo/database.json", JSON.stringify({
      meta: { dataVersion: 1, lastModified: "2026-11-09T00:00:00.000Z" },
      data: { schemaVersion: 4, tasks: [legacySource] },
    }));
    const migratedTasks = new TaskService(vault as never, "todo", series);

    await migratedTasks.init();

    expect(migratedTasks.getById("legacy-source")?.isRecurrenceTemplate).toBe(true);
    expect(migratedTasks.getGroupInstances("legacy-series"))
      .toContainEqual(expect.objectContaining({ title: "Legacy daily", isRecurrenceTemplate: false }));
    expect(series.get("legacy-series")?.rule).toBe("daily");

    const instanceIds = migratedTasks.getGroupInstances("legacy-series").map((task) => task.id);
    const reloadedSeries = new RecurrenceSeriesService(vault as never, "todo");
    await reloadedSeries.init();
    const reloadedTasks = new TaskService(vault as never, "todo", reloadedSeries);
    await reloadedTasks.init();

    expect(reloadedTasks.getGroupInstances("legacy-series").map((task) => task.id)).toEqual(instanceIds);
    expect(reloadedSeries.getAll()).toHaveLength(1);
  });
});
