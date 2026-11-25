import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "../src/models/Task";
import { RecurrenceSeriesService } from "../src/services/RecurrenceSeriesService";
import { TaskService } from "../src/services/TaskService";
import { CURRENT_TASK_SCHEMA_VERSION } from "../src/services/TaskDatabaseMigrations";

const DATABASE = "todo/database.json";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release: () => release() };
}

function database(tasks: Task[], schemaVersion = CURRENT_TASK_SCHEMA_VERSION): string {
  return JSON.stringify({
    meta: { dataVersion: 1, lastModified: "2026-11-24T00:00:00.000Z" },
    data: { schemaVersion, tasks },
  });
}

class FakeAdapter {
  files = new Map<string, string>();
  failNextDatabaseWrite = false;
  beforeRead?: (path: string) => Promise<void>;
  beforeWrite?: (path: string, content: string) => Promise<void>;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    await this.beforeRead?.(path);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    await this.beforeWrite?.(path, content);
    if (path === DATABASE && this.failNextDatabaseWrite) {
      this.failNextDatabaseWrite = false;
      throw new Error("simulated database write failure");
    }
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)), folders: [] };
  }

  pauseRead() {
    const started = gate();
    const proceed = gate();
    this.beforeRead = async (path) => {
      if (path !== DATABASE) return;
      this.beforeRead = undefined;
      started.release();
      await proceed.promise;
    };
    return { started: started.promise, release: proceed.release };
  }

  pauseWrite(target = DATABASE) {
    const started = gate();
    const proceed = gate();
    this.beforeWrite = async (path) => {
      if (path !== target) return;
      this.beforeWrite = undefined;
      started.release();
      await proceed.promise;
    };
    return { started: started.promise, release: proceed.release };
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

describe("TaskService concurrency and reload", () => {
  let vault: FakeVault;
  let service: TaskService;
  let series: RecurrenceSeriesService;

  beforeEach(async () => {
    vault = new FakeVault();
    series = new RecurrenceSeriesService(vault as never, "todo");
    await series.init();
    service = new TaskService(vault as never, "todo", series);
    await service.init();
  });

  it("adopts external additions, updates and deletions without writing any files", async () => {
    const old = await service.create({ title: "Old", tags: ["before"] });
    await service.create({ title: "Removed remotely" });
    const synced = createTask({ ...old, title: "Synced", tags: ["after"], isCompleted: true });
    const added = createTask({ title: "Added remotely" });
    const raw = database([synced, added]);
    vault.adapter.files.set(DATABASE, raw);
    const write = vi.spyOn(vault.adapter, "write");

    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "reloaded" });

    expect(service.getAll()).toEqual([synced, added]);
    expect(service.hasUnsavedChanges()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(vault.adapter.files.get(DATABASE)).toBe(raw);

    // A later initialization must not revive the pre-reload storage cache.
    await service.init();
    expect(service.getAll()).toEqual([synced, added]);
  });

  it("ignores local write echoes, metadata changes and JSON object key order", async () => {
    const task = await service.create({ title: "Same data" });
    const write = vi.spyOn(vault.adapter, "write");
    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "unchanged" });

    const reordered = Object.fromEntries(Object.entries(task).reverse());
    vault.adapter.files.set(DATABASE, JSON.stringify({
      meta: { dataVersion: 1, lastModified: "2099-01-01T00:00:00.000Z" },
      data: { tasks: [reordered], schemaVersion: CURRENT_TASK_SCHEMA_VERSION },
    }));
    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "unchanged" });
    expect(service.getById(task.id)).toBe(task);
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves tasks while the database is temporarily missing", async () => {
    const task = await service.create({ title: "Keep me" });
    vault.adapter.files.delete(DATABASE);
    const write = vi.spyOn(vault.adapter, "write");

    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "missing" });
    expect(service.getById(task.id)).toBe(task);
    expect(write).not.toHaveBeenCalled();
  });

  it("treats a never-created empty task database as unchanged", async () => {
    const freshVault = new FakeVault();
    const freshService = new TaskService(freshVault as never, "todo");
    await freshService.init();

    await expect(freshService.reloadFromDisk()).resolves.toEqual({ status: "unchanged" });
    expect(freshVault.adapter.files.has(DATABASE)).toBe(false);
  });

  it.each([
    "{ invalid json",
    JSON.stringify({ data: null }),
    JSON.stringify({ data: { tasks: [{ id: "invalid" }] } }),
    database([], CURRENT_TASK_SCHEMA_VERSION + 1),
  ])("rejects invalid snapshots without changing memory and keeps the queue usable: %s", async (raw) => {
    const task = await service.create({ title: "Valid local task" });
    vault.adapter.files.set(DATABASE, raw);

    await expect(service.reloadFromDisk()).rejects.toThrow();
    expect(service.getById(task.id)).toBe(task);
    expect(vault.adapter.files.get(DATABASE)).toBe(raw);
    expect(service.hasUnsavedChanges()).toBe(false);

    vault.adapter.files.set(DATABASE, database([task]));
    await service.update(task.id, { note: "Queue recovered" });
    expect(service.getById(task.id)?.note).toBe("Queue recovered");
  });

  it("migrates old snapshots only in memory without generating recurrence instances", async () => {
    const template = createTask({
      id: "legacy",
      recurrence: "daily",
      recurrenceGroupId: "legacy-series",
      isRecurrenceSource: true,
      isRecurrenceTemplate: true,
    });
    const raw = JSON.stringify({ data: { tasks: [{ ...template, myDayDate: "2024-04-05", isMyDay: true }] } });
    vault.adapter.files.set(DATABASE, raw);
    const write = vi.spyOn(vault.adapter, "write");

    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "reloaded" });

    expect(service.getAllIncludingDeleted()).toHaveLength(1);
    expect(service.getById(template.id)?.startDate).toBe("2024-04-05T07:00:00");
    expect(service.getById(template.id)).not.toHaveProperty("myDayDate");
    expect(series.getAll()).toEqual([]);
    expect(service.hasUnsavedChanges()).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(vault.adapter.files.get(DATABASE)).toBe(raw);
  });

  it("serializes whole create operations before they mutate the task array", async () => {
    const pause = vault.adapter.pauseWrite();
    const first = service.create({ id: "first", title: "First" });
    await pause.started;

    const second = service.create({ id: "second", title: "Second" });
    expect(service.getAll().map((task) => task.id)).toEqual(["first"]);
    pause.release();

    await Promise.all([first, second]);
    const stored = JSON.parse(vault.adapter.files.get(DATABASE)!);
    expect(stored.data.tasks.map((task: Task) => task.id)).toEqual(["first", "second"]);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it("captures queued inputs so callers cannot change the requested fields while waiting", async () => {
    const pause = vault.adapter.pauseWrite();
    const first = service.create({ id: "first" });
    await pause.started;

    const fields = { id: "second", title: "Queued", tags: ["original"] };
    const second = service.create(fields);
    fields.title = "Changed outside";
    fields.tags.push("outside");
    pause.release();
    await Promise.all([first, second]);

    expect(service.getById("second")).toMatchObject({ title: "Queued", tags: ["original"] });
  });

  it("reloads only after an update and its tag cascade finish saving", async () => {
    const parent = await service.create({ title: "Parent", tags: ["before"] });
    const child = await service.create({ title: "Child", parentId: parent.id, tags: ["before"] });
    const pause = vault.adapter.pauseWrite();
    const update = service.update(parent.id, { tags: ["after"] });
    await pause.started;
    const read = vi.spyOn(vault.adapter, "read");

    const reload = service.reloadFromDisk();
    expect(service.getById(child.id)?.tags).toEqual(["before"]);
    expect(read).not.toHaveBeenCalled();
    pause.release();
    await update;

    await expect(reload).resolves.toEqual({ status: "unchanged" });
    expect(service.getById(child.id)?.tags).toEqual(["after"]);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it("applies an edit queued during reload to the newly loaded task", async () => {
    const task = await service.create({ title: "Before" });
    vault.adapter.files.set(DATABASE, database([{ ...task, title: "Remote title" }]));
    const pause = vault.adapter.pauseRead();
    const reload = service.reloadFromDisk();
    await pause.started;

    const update = service.update(task.id, { note: "Local note" });
    expect(service.getById(task.id)?.title).toBe("Before");
    expect(service.getById(task.id)?.note).toBe("");
    pause.release();

    await expect(reload).resolves.toEqual({ status: "reloaded" });
    await update;
    expect(service.getById(task.id)).toMatchObject({ title: "Remote title", note: "Local note" });
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it("completes ancestors and deletes descendants without nested queue deadlocks", async () => {
    const parent = await service.create({ title: "Parent" });
    const child = await service.create({ title: "Child", parentId: parent.id });
    const grandchild = await service.create({ title: "Grandchild", parentId: child.id });

    const [completed, completionReload] = await Promise.all([
      service.complete(grandchild.id), service.reloadFromDisk(),
    ]);
    expect(completed?.isCompleted).toBe(true);
    expect(service.getById(parent.id)?.isCompleted).toBe(true);
    expect(completionReload).toEqual({ status: "unchanged" });

    await service.uncomplete(grandchild.id);
    expect(service.getById(parent.id)?.isCompleted).toBe(false);

    const [deleted, deletionReload] = await Promise.all([
      service.delete(parent.id), service.reloadFromDisk(),
    ]);
    expect(deleted).toBe(true);
    expect(deletionReload).toEqual({ status: "unchanged" });
    expect(service.getDeleted()).toHaveLength(3);
  });

  it("holds the task queue while a recurrence operation saves its series file", async () => {
    const task = await service.create({
      title: "Recurring", startDate: "2099-01-01T09:00:00", dueDate: "2099-01-01T10:00:00",
    });
    const pause = vault.adapter.pauseWrite("todo/recurrence-series.json");
    const recurrence = service.setRecurrence(task.id, "daily");
    await pause.started;

    const reload = service.reloadFromDisk();
    const update = service.update(task.id, { note: "After recurrence" });
    expect(service.getById(task.id)?.note).toBe("");
    pause.release();
    await recurrence;

    await expect(reload).resolves.toEqual({ status: "unchanged" });
    await update;
    expect(service.getById(task.id)).toMatchObject({ isRecurrenceTemplate: true, note: "After recurrence" });
    expect(series.getAll()).toHaveLength(1);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it("keeps failed edits in memory, defers reload and allows an explicit save retry", async () => {
    const task = await service.create({ title: "Before" });
    vault.adapter.failNextDatabaseWrite = true;

    await expect(service.update(task.id, { title: "Unsaved local edit" }))
      .rejects.toThrow("simulated database write failure");
    expect(service.getById(task.id)?.title).toBe("Unsaved local edit");
    expect(service.hasUnsavedChanges()).toBe(true);
    const read = vi.spyOn(vault.adapter, "read");

    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(read).not.toHaveBeenCalled();
    expect(JSON.parse(vault.adapter.files.get(DATABASE)!).data.tasks[0].title).toBe("Before");

    await service.retrySave();
    expect(service.hasUnsavedChanges()).toBe(false);
    expect(JSON.parse(vault.adapter.files.get(DATABASE)!).data.tasks[0].title).toBe("Unsaved local edit");
    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "unchanged" });
  });

  it("allows later local saves after a rejection without losing the earlier failed edit", async () => {
    vault.adapter.failNextDatabaseWrite = true;
    await expect(service.create({ id: "failed", title: "Keep failed create" })).rejects.toThrow();

    await service.create({ id: "next", title: "Next create" });

    expect(JSON.parse(vault.adapter.files.get(DATABASE)!).data.tasks.map((task: Task) => task.id))
      .toEqual(["failed", "next"]);
    expect(service.hasUnsavedChanges()).toBe(false);
  });

  it("rejects a stale reload snapshot if an exposed task reference changes during the read", async () => {
    const task = await service.create({ title: "Before" });
    const raw = database([{ ...task, title: "Remote" }]);
    vault.adapter.files.set(DATABASE, raw);
    const pause = vault.adapter.pauseRead();
    const reload = service.reloadFromDisk();
    await pause.started;

    task.title = "Unsaved reference edit";
    pause.release();

    await expect(reload).resolves.toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(service.getById(task.id)?.title).toBe("Unsaved reference edit");
    expect(vault.adapter.files.get(DATABASE)).toBe(raw);
  });

  it("persists a stable snapshot and detects reference edits made while awaiting a backup", async () => {
    const task = await service.create({ title: "Before", tags: ["before"] });
    const pause = vault.adapter.pauseRead();
    const update = service.update(task.id, { title: "Saved title" });
    await pause.started;

    service.getById(task.id)!.tags.push("during-backup");
    pause.release();
    await update;

    expect(JSON.parse(vault.adapter.files.get(DATABASE)!).data.tasks[0].tags).toEqual(["before"]);
    expect(service.getById(task.id)?.tags).toEqual(["before", "during-backup"]);
    expect(service.hasUnsavedChanges()).toBe(true);
    await expect(service.reloadFromDisk()).resolves.toEqual({ status: "deferred", reason: "unsaved-changes" });
  });

  it("queues initialization before later operations and recovers from an initialization guard error", async () => {
    const fresh = new TaskService(vault as never, "todo");
    await expect(fresh.create({ title: "Too early" })).rejects.toThrow(/not initialized/);

    const init = fresh.init();
    const create = fresh.create({ title: "After init" });
    await init;
    await expect(create).resolves.toMatchObject({ title: "After init" });
    expect(fresh.hasUnsavedChanges()).toBe(false);
  });
});
