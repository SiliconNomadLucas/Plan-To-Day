import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupService } from "../src/services/GroupService";
import { ListService } from "../src/services/ListService";
import { RecurrenceSeriesService } from "../src/services/RecurrenceSeriesService";
import { TagService } from "../src/services/TagService";

class FakeAdapter {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return content;
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

describe("persistent services", () => {
  let vault: FakeVault;

  beforeEach(() => {
    vault = new FakeVault();
  });

  it("uses the same initialization guard and reloadable storage pattern", async () => {
    const groups = new GroupService(vault as never, "todo");
    const tags = new TagService(vault as never, "todo");
    const series = new RecurrenceSeriesService(vault as never, "todo");

    expect(() => groups.getAll()).toThrow("GroupService not initialized. Call init() first.");
    expect(() => tags.getAll()).toThrow("TagService not initialized. Call init() first.");
    expect(() => series.getAll()).toThrow("RecurrenceSeriesService not initialized. Call init() first.");

    await Promise.all([groups.init(), tags.init(), series.init()]);
    await groups.create({ id: "group-1", name: "Work" });
    await tags.create({ id: "tag-1", name: "Focus" });

    const reloadedGroups = new GroupService(vault as never, "todo");
    const reloadedTags = new TagService(vault as never, "todo");
    const reloadedSeries = new RecurrenceSeriesService(vault as never, "todo");
    await Promise.all([reloadedGroups.init(), reloadedTags.init(), reloadedSeries.init()]);

    expect(reloadedGroups.getById("group-1")?.name).toBe("Work");
    expect(reloadedTags.getById("tag-1")?.name).toBe("Focus");
    expect(reloadedTags.getAll()).toHaveLength(15);
    expect(reloadedSeries.getAll()).toEqual([]);
  });

  it("creates and persists the default list through the shared lifecycle", async () => {
    const lists = new ListService(vault as never, "todo", "Inbox");

    expect(() => lists.getActive()).toThrow("ListService not initialized. Call init() first.");
    await lists.init();

    expect(lists.getDefault()?.name).toBe("Inbox");
    const stored = JSON.parse(vault.adapter.files.get("todo/lists.json")!);
    expect(stored.data.lists).toHaveLength(1);
    expect(stored.data.lists[0].isDefault).toBe(true);
  });

  it("reloads each associated store atomically without creating defaults or writing files", async () => {
    const lists = new ListService(vault as never, "todo", "Inbox");
    const tags = new TagService(vault as never, "todo");
    const groups = new GroupService(vault as never, "todo");
    const series = new RecurrenceSeriesService(vault as never, "todo");
    await Promise.all([lists.init(), tags.init(), groups.init(), series.init()]);
    const originalList = await lists.create({ id: "local-list", name: "Local" });
    const originalTag = await tags.create({ id: "local-tag", name: "Local tag" });
    const originalGroup = await groups.create({ id: "local-group", name: "Local group" });
    const originalSeries = await series.upsert({
      id: "local-series", rule: "daily", startDate: "2026-11-25", endDate: null,
      title: "Local series", note: "", listId: "", tags: [], isImportant: false,
      createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
    });
    const write = vi.spyOn(vault.adapter, "write");
    const externalList = { ...originalList, name: "Synced list" };
    const externalTag = { ...originalTag, name: "Synced tag", color: "#123456" };
    const externalGroup = { ...originalGroup, name: "Synced group" };
    const externalSeries = { ...originalSeries, title: "Synced series", tags: ["synced-tag"] };
    vault.adapter.files.set("todo/lists.json", JSON.stringify({ data: { lists: [externalList] } }));
    vault.adapter.files.set("todo/tags.json", JSON.stringify({ data: { tags: [externalTag] } }));
    vault.adapter.files.set("todo/groups.json", JSON.stringify({ data: { groups: [externalGroup] } }));
    vault.adapter.files.set("todo/recurrence-series.json", JSON.stringify({ data: { series: [externalSeries] } }));

    const outcomes = await Promise.all([
      lists.reloadFromDisk(), tags.reloadFromDisk(), groups.reloadFromDisk(), series.reloadFromDisk(),
    ]);

    expect(outcomes).toEqual([
      { status: "reloaded" }, { status: "reloaded" }, { status: "reloaded" }, { status: "reloaded" },
    ]);
    expect(lists.getById("local-list")?.name).toBe("Synced list");
    expect(tags.getById("local-tag")?.name).toBe("Synced tag");
    expect(groups.getById("local-group")?.name).toBe("Synced group");
    expect(series.get("local-series")?.title).toBe("Synced series");
    expect(series.getAll()).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();

    expect(await lists.reloadFromDisk()).toEqual({ status: "unchanged" });
    expect(await tags.reloadFromDisk()).toEqual({ status: "unchanged" });
    expect(await groups.reloadFromDisk()).toEqual({ status: "unchanged" });
    expect(await series.reloadFromDisk()).toEqual({ status: "unchanged" });
  });

  it("preserves associated data on missing, malformed, and locally edited snapshots", async () => {
    const lists = new ListService(vault as never, "todo", "Inbox");
    const tags = new TagService(vault as never, "todo");
    const groups = new GroupService(vault as never, "todo");
    const series = new RecurrenceSeriesService(vault as never, "todo");
    await Promise.all([lists.init(), tags.init(), groups.init(), series.init()]);
    const localList = await lists.create({ id: "local-list", name: "Local" });
    const localTag = await tags.create({ id: "local-tag", name: "Local tag" });
    const localGroup = await groups.create({ id: "local-group", name: "Local group" });
    const localSeries = await series.upsert({
      id: "local-series", rule: "weekly", startDate: "2026-11-25", endDate: null,
      title: "Local series", note: "", listId: "", tags: [], isImportant: false,
      createdAt: "2026-11-25T00:00:00.000Z", updatedAt: "2026-11-25T00:00:00.000Z",
    });

    for (const filename of ["lists.json", "tags.json", "groups.json", "recurrence-series.json"]) {
      vault.adapter.files.delete(`todo/${filename}`);
    }
    expect(await lists.reloadFromDisk()).toEqual({ status: "missing" });
    expect(await tags.reloadFromDisk()).toEqual({ status: "missing" });
    expect(await groups.reloadFromDisk()).toEqual({ status: "missing" });
    expect(await series.reloadFromDisk()).toEqual({ status: "missing" });
    expect(lists.getById(localList.id)?.name).toBe("Local");
    expect(tags.getById(localTag.id)?.name).toBe("Local tag");
    expect(groups.getById(localGroup.id)?.name).toBe("Local group");
    expect(series.get(localSeries.id)?.title).toBe("Local series");

    vault.adapter.files.set("todo/lists.json", JSON.stringify({ data: { lists: [{ id: "bad" }] } }));
    vault.adapter.files.set("todo/tags.json", "{ incomplete");
    vault.adapter.files.set("todo/groups.json", JSON.stringify({ data: { groups: "bad" } }));
    vault.adapter.files.set("todo/recurrence-series.json", JSON.stringify({ data: { series: [{ id: "bad" }] } }));
    await expect(lists.reloadFromDisk()).rejects.toThrow();
    await expect(tags.reloadFromDisk()).rejects.toThrow();
    await expect(groups.reloadFromDisk()).rejects.toThrow();
    await expect(series.reloadFromDisk()).rejects.toThrow();
    expect(lists.getById(localList.id)?.name).toBe("Local");
    expect(tags.getById(localTag.id)?.name).toBe("Local tag");
    expect(groups.getById(localGroup.id)?.name).toBe("Local group");
    expect(series.get(localSeries.id)?.title).toBe("Local series");

    vault.adapter.files.set("todo/lists.json", JSON.stringify({ data: { lists: [{ ...localList, name: "Remote" }] } }));
    vault.adapter.files.set("todo/tags.json", JSON.stringify({ data: { tags: [{ ...localTag, name: "Remote" }] } }));
    vault.adapter.files.set("todo/groups.json", JSON.stringify({ data: { groups: [{ ...localGroup, name: "Remote" }] } }));
    vault.adapter.files.set("todo/recurrence-series.json", JSON.stringify({ data: { series: [{ ...localSeries, title: "Remote" }] } }));
    lists.getById(localList.id)!.name = "Unsaved local list";
    tags.getById(localTag.id)!.name = "Unsaved local tag";
    groups.getById(localGroup.id)!.name = "Unsaved local group";
    series.get(localSeries.id)!.title = "Unsaved local series";
    expect(await lists.reloadFromDisk()).toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(await tags.reloadFromDisk()).toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(await groups.reloadFromDisk()).toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(await series.reloadFromDisk()).toEqual({ status: "deferred", reason: "unsaved-changes" });
    expect(lists.getById(localList.id)?.name).toBe("Unsaved local list");
    expect(tags.getById(localTag.id)?.name).toBe("Unsaved local tag");
    expect(groups.getById(localGroup.id)?.name).toBe("Unsaved local group");
    expect(series.get(localSeries.id)?.title).toBe("Unsaved local series");
  });

  it("does not mark lists unsaved when rendering sorts the displayed list copy", async () => {
    const lists = new ListService(vault as never, "todo", "Inbox");
    await lists.init();
    await lists.create({ id: "later", name: "Later", sortOrder: 2 });
    await lists.create({ id: "earlier", name: "Earlier", sortOrder: 1 });

    expect(lists.getActive().map((list) => list.id)).toEqual([lists.getDefault()!.id, "earlier", "later"]);
    expect(lists.hasUnsavedChanges()).toBe(false);
    vault.adapter.files.set("todo/lists.json", JSON.stringify({ data: { lists: [
      ...lists.getActive().map((list) => ({ ...list, name: `${list.name} synced` })),
    ] } }));
    expect(await lists.reloadFromDisk()).toEqual({ status: "reloaded" });
  });

  it("treats never-created empty group and recurrence files as unchanged", async () => {
    const groups = new GroupService(vault as never, "todo");
    const series = new RecurrenceSeriesService(vault as never, "todo");
    await Promise.all([groups.init(), series.init()]);

    expect(await groups.reloadFromDisk()).toEqual({ status: "unchanged" });
    expect(await series.reloadFromDisk()).toEqual({ status: "unchanged" });
    expect(vault.adapter.files.has("todo/groups.json")).toBe(false);
    expect(vault.adapter.files.has("todo/recurrence-series.json")).toBe(false);
  });
});
