import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { DataSyncReloadResult } from "../src/models/DataSyncReloadResult";
import { SYNC_DATA_FILES, type SyncDataFile } from "../src/models/SyncDataFile";
import { createTask } from "../src/models/Task";
import { DataSyncCoordinator } from "../src/services/DataSyncCoordinator";
import { TaskService } from "../src/services/TaskService";
import { CURRENT_TASK_SCHEMA_VERSION } from "../src/services/TaskDatabaseMigrations";
import { logger } from "../src/utils/logger";

const DATABASE = "todo/database.json";
type ChangeListener = (file: { path: string }, oldPath?: string) => void;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class FakeAdapter {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const raw = this.files.get(path);
    if (raw === undefined) throw new Error(`Missing file: ${path}`);
    return raw;
  }
  async write(path: string, raw: string): Promise<void> { this.files.set(path, raw); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()].filter((file) => file.startsWith(`${path}/`)), folders: [] };
  }
}

class FakeVault {
  adapter = new FakeAdapter();
  listeners = new Map<string, Set<ChangeListener>>();

  on(name: string, listener: ChangeListener) {
    const listeners = this.listeners.get(name) ?? new Set<ChangeListener>();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return { detach: () => listeners.delete(listener) };
  }
  emit(name: string, path = DATABASE, oldPath?: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener({ path }, oldPath);
  }
  async createFolder(_path: string): Promise<void> {}
  getAbstractFileByPath(path: string): TFile | null {
    if (!this.adapter.files.has(path)) return null;
    const file = new TFile();
    file.path = path;
    return file;
  }
  async read(file: { path: string }): Promise<string> { return this.adapter.read(file.path); }
  async create(path: string, raw: string): Promise<void> {
    await this.adapter.write(path, raw);
    this.emit("create", path);
  }
  async modify(file: { path: string }, raw: string): Promise<void> {
    await this.adapter.write(file.path, raw);
    this.emit("modify", file.path);
  }
}

class FakeWindow extends EventTarget {
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}

class FakeDocument extends EventTarget {
  visibilityState = "visible";
}

describe("DataSyncCoordinator", () => {
  let vault: FakeVault;
  let coordinator: DataSyncCoordinator;
  let reload: ReturnType<typeof vi.fn<(files: readonly SyncDataFile[]) => Promise<DataSyncReloadResult>>>;
  let onReloaded: ReturnType<typeof vi.fn>;
  let taskWindow: FakeWindow;
  let taskDocument: FakeDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    taskWindow = new FakeWindow();
    taskDocument = new FakeDocument();
    vi.stubGlobal("window", taskWindow);
    vi.stubGlobal("document", taskDocument);
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vault = new FakeVault();
    reload = vi.fn<(files: readonly SyncDataFile[]) => Promise<DataSyncReloadResult>>().mockResolvedValue({ status: "unchanged" });
    onReloaded = vi.fn();
    coordinator = new DataSyncCoordinator(vault as never, "todo", reload, onReloaded);
  });

  afterEach(() => {
    coordinator.unload();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function startWatching(): Promise<void> {
    coordinator.load();
    await vi.advanceTimersByTimeAsync(500);
    reload.mockClear();
    onReloaded.mockClear();
  }

  it("checks once after startup and registers the four Vault events", async () => {
    coordinator.load();
    await vi.advanceTimersByTimeAsync(499);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
    expect([...vault.listeners.keys()].sort()).toEqual(["create", "delete", "modify", "rename"]);
    expect(reload).toHaveBeenCalledWith(SYNC_DATA_FILES);
  });

  it.each(["modify", "create", "delete"])("reloads a database %s event after debouncing", async (event) => {
    await startWatching();
    vault.emit(event);
    await vi.advanceTimersByTimeAsync(499);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    [DATABASE, "todo/database.tmp"],
    ["todo/database.tmp", DATABASE],
    ["archive", "todo"],
    ["todo", "archive"],
  ])("handles renames involving either the new or old database/folder path: %s <- %s", async (path, oldPath) => {
    await startWatching();
    vault.emit("rename", path, oldPath);
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("ignores backup, conflict, unrelated and other service files", async () => {
    await startWatching();
    for (const path of [
      "todo/backups/2026-11-24_database.json", "todo/database (conflict).json", "todo/database.json.tmp",
      "other/database.json", "todo-other/database.json", "note.md",
    ]) vault.emit("modify", path);
    vault.emit("rename", "todo/database-copy.json", "other/database.json");
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(SYNC_DATA_FILES)("routes only %s events to their matching data reload", async (filename) => {
    await startWatching();
    vault.emit("modify", `todo/${filename}`);
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledWith([filename]);
  });

  it("routes same-folder events and renamed old paths across the whole data set", async () => {
    await startWatching();
    vault.emit("delete", "todo");
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenNthCalledWith(1, SYNC_DATA_FILES);

    reload.mockClear();
    vault.emit("rename", "archive/lists.json", "todo/lists.json");
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledWith(["lists.json"]);
  });

  it("retries only the associated file that was not ready in a synchronized batch", async () => {
    await startWatching();
    reload.mockResolvedValueOnce({ status: "reloaded", retryFiles: ["lists.json"] })
      .mockResolvedValueOnce({ status: "unchanged" });
    for (const filename of SYNC_DATA_FILES) vault.emit("modify", `todo/${filename}`);

    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledWith(SYNC_DATA_FILES);
    expect(onReloaded).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenNthCalledWith(2, ["lists.json"]);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it("uses the configured nested data folder and handles parent folder removal", async () => {
    coordinator = new DataSyncCoordinator(vault as never, "plans/tasks/", reload, onReloaded);
    await startWatching();
    vault.emit("modify", DATABASE);
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).not.toHaveBeenCalled();
    vault.emit("modify", "plans/tasks/database.json");
    await vi.advanceTimersByTimeAsync(500);
    vault.emit("delete", "plans");
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("coalesces delete, create and modify bursts into one final check", async () => {
    await startWatching();
    vault.emit("delete");
    await vi.advanceTimersByTimeAsync(200);
    vault.emit("create");
    await vi.advanceTimersByTimeAsync(200);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(499);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("notifies only when task data changed and does not retry local write echoes", async () => {
    await startWatching();
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(10000);
    expect(reload).toHaveBeenCalledOnce();
    expect(onReloaded).not.toHaveBeenCalled();

    reload.mockResolvedValueOnce({ status: "reloaded" });
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it.each<DataSyncReloadResult>([
    { status: "missing", retryFiles: ["database.json"] },
    { status: "deferred", reason: "unsaved-changes", retryFiles: ["database.json"] },
  ])("bounds retries for $status and allows a new event to restart checking", async (result) => {
    await startWatching();
    reload.mockResolvedValue(result);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(reload).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(10000);
    expect(reload).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);

    reload.mockResolvedValue({ status: "reloaded" });
    vault.emit("create");
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(5);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it("retries transient parse/read failures and adopts the next valid snapshot", async () => {
    await startWatching();
    reload.mockRejectedValueOnce(new Error("incomplete JSON")).mockResolvedValueOnce({ status: "reloaded" });
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(onReloaded).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("stops retrying persistent read failures without an unhandled rejection", async () => {
    await startWatching();
    reload.mockRejectedValue(new Error("corrupt database"));
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(10000);
    expect(reload).toHaveBeenCalledTimes(4);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains events received during a long reload without overlapping reads", async () => {
    await startWatching();
    const first = deferred<DataSyncReloadResult>();
    reload.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ status: "reloaded" });
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledOnce();

    first.resolve({ status: "unchanged" });
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it("preserves a newer event's debounce when the running reload fails", async () => {
    await startWatching();
    const first = deferred<DataSyncReloadResult>();
    reload.mockReturnValueOnce(first.promise);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    vault.emit("modify");
    first.resolve({ status: "missing" });
    await vi.advanceTimersByTimeAsync(499);
    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("supplements file events with focus and foreground visibility checks", async () => {
    await startWatching();
    taskDocument.visibilityState = "hidden";
    taskDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).not.toHaveBeenCalled();

    taskWindow.dispatchEvent(new Event("focus"));
    taskDocument.visibilityState = "visible";
    taskDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("cancels pending checks while paused and rechecks once after the final resume", async () => {
    await startWatching();
    vault.emit("modify");
    await coordinator.pause();
    await coordinator.pause();
    vault.emit("delete");
    taskWindow.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();

    coordinator.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).not.toHaveBeenCalled();
    coordinator.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight reload before allowing reset to proceed", async () => {
    await startWatching();
    const first = deferred<DataSyncReloadResult>();
    reload.mockReturnValueOnce(first.promise);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    let paused = false;
    const pause = coordinator.pause().then(() => { paused = true; });
    await Promise.resolve();
    expect(paused).toBe(false);

    first.resolve({ status: "reloaded" });
    await pause;
    expect(paused).toBe(true);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    coordinator.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("releases file/DOM listeners and pending timers on unload", async () => {
    await startWatching();
    vault.emit("modify");
    coordinator.unload();
    vault.emit("modify");
    taskWindow.dispatchEvent(new Event("focus"));
    taskDocument.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(reload).not.toHaveBeenCalled();
    expect([...vault.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an old in-flight result after unloading and loading again", async () => {
    await startWatching();
    const old = deferred<DataSyncReloadResult>();
    reload.mockReturnValueOnce(old.promise);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    coordinator.unload();
    coordinator.load();
    old.resolve({ status: "reloaded" });
    await vi.advanceTimersByTimeAsync(500);

    expect(onReloaded).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(2);
    expect([...vault.listeners.values()].every((listeners) => listeners.size === 1)).toBe(true);
  });

  it("connects actual TaskService reloads to sync events and ignores the subsequent local write echo", async () => {
    const service = new TaskService(vault as never, "todo");
    await service.init();
    const local = await service.create({ title: "Local" });
    coordinator = new DataSyncCoordinator(vault as never, "todo", () => service.reloadFromDisk(), onReloaded);
    await startWatching();

    const remote = createTask({ title: "Remote addition" });
    const raw = JSON.stringify({ data: {
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
      tasks: [{ ...local, title: "Synced title" }, remote],
    } });
    vault.adapter.files.set(DATABASE, raw);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    expect(service.getById(local.id)?.title).toBe("Synced title");
    expect(service.getById(remote.id)?.title).toBe("Remote addition");
    expect(vault.adapter.files.get(DATABASE)).toBe(raw);
    expect(onReloaded).toHaveBeenCalledOnce();

    await service.update(local.id, { note: "Local edit after sync" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(service.getById(local.id)?.note).toBe("Local edit after sync");
    expect(onReloaded).toHaveBeenCalledOnce();
  });

  it("waits through a long edit without exhausting retries, then reloads and refreshes once", async () => {
    let editing = true;
    const canReload = vi.fn(() => !editing);
    coordinator = new DataSyncCoordinator(vault as never, "todo", reload, onReloaded, canReload);
    coordinator.load();
    reload.mockResolvedValue({ status: "reloaded" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(reload).not.toHaveBeenCalled();
    expect(onReloaded).not.toHaveBeenCalled();
    editing = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(reload).toHaveBeenCalledOnce();
    expect(onReloaded).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the refresh notification when editing starts during the disk read", async () => {
    const diskRead = deferred<DataSyncReloadResult>();
    let editing = false;
    onReloaded.mockImplementation(() => !editing);
    coordinator = new DataSyncCoordinator(vault as never, "todo", reload, onReloaded, () => !editing);
    await startWatching();
    reload.mockReturnValueOnce(diskRead.promise);
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    editing = true;
    diskRead.resolve({ status: "reloaded" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onReloaded).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();

    editing = false;
    await vi.advanceTimersByTimeAsync(250);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(onReloaded).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("awaits async painting and retries its failure even when the next reload is unchanged", async () => {
    await startWatching();
    const paint = deferred<void>();
    onReloaded.mockRejectedValueOnce(new Error("paint failed")).mockReturnValueOnce(paint.promise);
    reload.mockResolvedValueOnce({ status: "reloaded" });
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(1000);
    expect(onReloaded).toHaveBeenCalledTimes(2);
    let paused = false;
    const pause = coordinator.pause().then(() => { paused = true; });
    await Promise.resolve();
    expect(paused).toBe(false);
    paint.resolve();
    await pause;
    expect(paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an interaction wait when unloaded", async () => {
    coordinator = new DataSyncCoordinator(vault as never, "todo", reload, onReloaded, () => false);
    coordinator.load();
    await vi.advanceTimersByTimeAsync(500);
    coordinator.unload();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps actual tasks while sync briefly writes invalid JSON and recovers on retry", async () => {
    const service = new TaskService(vault as never, "todo");
    await service.init();
    const task = await service.create({ title: "Keep local data" });
    coordinator = new DataSyncCoordinator(vault as never, "todo", () => service.reloadFromDisk(), onReloaded);
    await startWatching();

    vault.adapter.files.set(DATABASE, "{ incomplete JSON");
    vault.emit("modify");
    await vi.advanceTimersByTimeAsync(500);
    expect(service.getById(task.id)?.title).toBe("Keep local data");
    expect(onReloaded).not.toHaveBeenCalled();

    vault.adapter.files.set(DATABASE, JSON.stringify({ data: {
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION, tasks: [{ ...task, title: "Recovered sync" }],
    } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(service.getById(task.id)?.title).toBe("Recovered sync");
    expect(onReloaded).toHaveBeenCalledOnce();
  });
});
