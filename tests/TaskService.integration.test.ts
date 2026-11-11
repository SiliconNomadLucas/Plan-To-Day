import { beforeEach, describe, expect, it } from "vitest";
import { createTask } from "../src/models/Task";
import { TaskService } from "../src/services/TaskService";
import { CURRENT_TASK_SCHEMA_VERSION } from "../src/services/TaskDatabaseMigrations";

class FakeAdapter {
  files = new Map<string, string>();
  failNextWrite = false;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }

  async write(path: string, content: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated write failure");
    }
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

describe("TaskService integration", () => {
  let vault: FakeVault;
  let service: TaskService;
  let backupWarnings: number;

  beforeEach(async () => {
    vault = new FakeVault();
    backupWarnings = 0;
    service = new TaskService(vault as never, "todo", undefined, () => { backupWarnings++; });
    await service.init();
  });

  it("persists create and update operations", async () => {
    const task = await service.create({ title: "Write tests", tags: ["work"] });
    expect(service.getById(task.id)?.title).toBe("Write tests");

    await service.update(task.id, { title: "Write more tests" });
    expect(service.getById(task.id)?.title).toBe("Write more tests");

    const stored = JSON.parse(vault.adapter.files.get("todo/database.json")!);
    expect(stored.data.tasks[0].title).toBe("Write more tests");
  });

  it("continues saving and notifies once when the daily backup fails", async () => {
    const task = await service.create({ title: "Before backup failure" });
    vault.adapter.failNextWrite = true;

    await service.update(task.id, { title: "Saved despite backup failure" });

    expect(service.getById(task.id)?.title).toBe("Saved despite backup failure");
    expect(backupWarnings).toBe(1);
    expect(JSON.parse(vault.adapter.files.get("todo/database.json")!).data.tasks[0].title)
      .toBe("Saved despite backup failure");
  });

  it("completes a parent after all children are complete", async () => {
    const parent = await service.create({ title: "Release" });
    const first = await service.create({ title: "Build", parentId: parent.id });
    const second = await service.create({ title: "Verify", parentId: parent.id });

    await service.complete(first.id);
    expect(service.getById(parent.id)?.isCompleted).toBe(false);

    await service.complete(second.id);
    expect(service.getById(parent.id)?.isCompleted).toBe(true);
  });

  it("cascades tags when a parent changes", async () => {
    const parent = await service.create({ title: "Project", tags: ["old"] });
    const child = await service.create({ title: "Task", parentId: parent.id });

    await service.update(parent.id, { tags: ["new"] });

    expect(service.getById(child.id)?.tags).toEqual(["new"]);
  });

  it("soft deletes descendants and restores the parent", async () => {
    const parent = await service.create({ title: "Parent" });
    const child = await service.create({ title: "Child", parentId: parent.id });

    await service.delete(parent.id);
    expect(service.getById(parent.id)?.isDeleted).toBe(true);
    expect(service.getById(child.id)?.isDeleted).toBe(true);
    expect(service.getDeleted()).toHaveLength(2);

    expect(await service.restore(parent.id)).toBe(true);
    expect(service.getById(parent.id)?.isDeleted).toBe(false);
    expect(service.getById(child.id)?.isDeleted).toBe(true);
  });

  it("migrates and persists an unversioned database during initialization", async () => {
    const legacyTask = {
      ...createTask({
        id: "legacy-day",
        startDate: null,
        dueDate: null,
      }),
      myDayDate: "2024-04-05",
      isMyDay: true,
    };
    vault.adapter.files.set("todo/database.json", JSON.stringify({
      meta: { dataVersion: 1, lastModified: "2024-04-05T00:00:00.000Z" },
      data: { tasks: [legacyTask] },
    }));
    const migratedService = new TaskService(vault as never, "todo");

    await migratedService.init();

    const task = migratedService.getById("legacy-day")!;
    const persisted = JSON.parse(vault.adapter.files.get("todo/database.json")!);
    expect(task.startDate).toBe("2024-04-05T07:00:00");
    expect(task.dueDate).toBe("2024-04-05T23:30:00");
    expect(persisted.data.schemaVersion).toBe(CURRENT_TASK_SCHEMA_VERSION);
    expect(persisted.data.tasks[0]).not.toHaveProperty("myDayDate");
    expect(persisted.data.tasks[0]).not.toHaveProperty("isMyDay");
  });

  it("refuses a future schema without rewriting the stored database", async () => {
    const original = JSON.stringify({
      meta: { dataVersion: 1, lastModified: "2026-11-09T00:00:00.000Z" },
      data: { schemaVersion: CURRENT_TASK_SCHEMA_VERSION + 1, tasks: [] },
    });
    vault.adapter.files.set("todo/database.json", original);
    const newerService = new TaskService(vault as never, "todo");

    await expect(newerService.init()).rejects.toThrow(/newer than supported/);
    expect(vault.adapter.files.get("todo/database.json")).toBe(original);
  });

  it("does not replace malformed database JSON with an empty task database", async () => {
    const original = "{ invalid json";
    vault.adapter.files.set("todo/database.json", original);
    const corruptService = new TaskService(vault as never, "todo");

    await expect(corruptService.init()).rejects.toThrow();
    expect(vault.adapter.files.get("todo/database.json")).toBe(original);
  });
});
