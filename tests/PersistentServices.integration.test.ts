import { beforeEach, describe, expect, it } from "vitest";
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
});
