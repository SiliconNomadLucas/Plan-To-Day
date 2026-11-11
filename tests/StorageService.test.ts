import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorageService } from "../src/services/StorageService";

class FakeAdapter {
  files = new Map<string, string>();
  failNextWrite = false;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return content;
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

describe("StorageService", () => {
  let vault: FakeVault;
  let storage: StorageService;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    vault = new FakeVault();
    storage = new StorageService(vault as never, "todo");
    await storage.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes and reads the wrapped data format", async () => {
    await storage.write("database.json", { value: 1 });

    await expect(storage.read<{ value: number }>("database.json")).resolves.toEqual({ value: 1 });
    const raw = JSON.parse(vault.adapter.files.get("todo/database.json")!);
    expect(raw.meta.dataVersion).toBe(1);
    expect(raw.data).toEqual({ value: 1 });
  });

  it("continues writing after a previous write fails", async () => {
    vault.adapter.failNextWrite = true;

    await expect(storage.write("database.json", { value: 1 })).rejects.toThrow("simulated write failure");
    await expect(storage.write("database.json", { value: 2 })).resolves.toBeUndefined();
    await expect(storage.read<{ value: number }>("database.json")).resolves.toEqual({ value: 2 });
  });

  it("surfaces corrupt JSON instead of treating an existing file as missing", async () => {
    vault.adapter.files.set("todo/database.json", "{ invalid json");

    await expect(storage.read("database.json")).rejects.toThrow();
    expect(vault.adapter.files.get("todo/database.json")).toBe("{ invalid json");
  });

  it("keeps the first pre-change snapshot for the day instead of overwriting it", async () => {
    await storage.write("database.json", { value: 1 });
    expect(await storage.backup("database.json")).toBe("created");
    const firstSnapshot = vault.adapter.files.get("todo/backups/2026-11-09_database.json");

    await storage.write("database.json", { value: 2 });
    expect(await storage.backup("database.json")).toBe("already-exists");

    expect(vault.adapter.files.get("todo/backups/2026-11-09_database.json")).toBe(firstSnapshot);
    expect(JSON.parse(firstSnapshot!).data).toEqual({ value: 1 });
  });

  it("serializes concurrent daily backups into one immutable snapshot", async () => {
    await storage.write("database.json", { value: "before" });
    const results = await Promise.all([
      storage.backup("database.json"),
      storage.backup("database.json"),
      storage.backup("database.json"),
    ]);

    expect(results.filter((result) => result === "created")).toHaveLength(1);
    expect([...vault.adapter.files.keys()].filter((path) => path.includes("/backups/"))).toEqual([
      "todo/backups/2026-11-09_database.json",
    ]);
    expect(JSON.parse(vault.adapter.files.get("todo/backups/2026-11-09_database.json")!).data)
      .toEqual({ value: "before" });
  });

  it("prunes old matching snapshots while leaving other backup files untouched", async () => {
    storage = new StorageService(vault as never, "todo", 3);
    await storage.init();
    for (const date of ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]) {
      vault.adapter.files.set(`todo/backups/${date}_database.json`, date);
    }
    vault.adapter.files.set("todo/backups/2026-11-01_lists.json", "keep");
    await storage.write("database.json", { value: "today" });

    await expect(storage.backup("database.json")).resolves.toBe("created");

    const backupNames = [...vault.adapter.files.keys()]
      .filter((path) => path.startsWith("todo/backups/"))
      .map((path) => path.substring("todo/backups/".length));
    expect(backupNames.filter((name) => name.endsWith("_database.json")).sort()).toEqual([
      "2026-11-07_database.json",
      "2026-11-08_database.json",
      "2026-11-09_database.json",
    ]);
    expect(vault.adapter.files.has("todo/backups/2026-11-01_lists.json")).toBe(true);
  });

  it("serializes concurrent writes and preserves the last write", async () => {
    const first = storage.write("database.json", { value: 1 });
    const second = storage.write("database.json", { value: 2 });

    await Promise.all([first, second]);
    await expect(storage.read<{ value: number }>("database.json")).resolves.toEqual({ value: 2 });
  });
});
