import { describe, expect, it } from "vitest";
import { createTask, type Task } from "../src/models/Task";
import { TaskHierarchyManager } from "../src/services/TaskHierarchyManager";

function managerFor(tasks: Task[], isImportantTag: (tagId: string) => boolean = () => false) {
  let saves = 0;
  return {
    manager: new TaskHierarchyManager(() => tasks, async () => { saves++; }, isImportantTag),
    getSaves: () => saves,
  };
}

describe("TaskHierarchyManager", () => {
  it("cascades parent tags through all descendants", () => {
    const parent = createTask({ id: "parent", tags: ["old"], isImportant: true });
    const child = createTask({ id: "child", parentId: "parent" });
    const grandchild = createTask({ id: "grandchild", parentId: "child" });
    const { manager } = managerFor([parent, child, grandchild]);

    manager.cascadeTags("parent", ["work"]);

    expect(child.tags).toEqual(["work"]);
    expect(grandchild.tags).toEqual(["work"]);
    expect(child.isImportant).toBe(true);
    expect(grandchild.isImportant).toBe(true);
  });

  it("inherits importance when attaching an existing task to a parent", () => {
    const parent = createTask({ id: "parent", tags: ["urgent"], isImportant: true });
    const child = createTask({ id: "child", parentId: "parent", tags: ["other"] });
    const grandchild = createTask({ id: "grandchild", parentId: "child" });
    const { manager } = managerFor([parent, child, grandchild]);

    manager.inheritParentTags(child, parent.id);

    expect(child.tags).toEqual(["urgent"]);
    expect(child.isImportant).toBe(true);
    expect(grandchild.tags).toEqual(["urgent"]);
    expect(grandchild.isImportant).toBe(true);
  });

  it("recognizes an important quadrant tag even when the parent's old flag is false", () => {
    const parent = createTask({ id: "parent", tags: ["urgent"], isImportant: false });
    const child = createTask({ id: "child", parentId: parent.id });
    const { manager } = managerFor([parent, child], (tagId) => tagId === "urgent");

    manager.inheritParentTags(child, parent.id);

    expect(child.tags).toEqual(["urgent"]);
    expect(child.isImportant).toBe(true);
  });

  it("completes a parent only after every child is complete", async () => {
    const parent = createTask({ id: "parent" });
    const first = createTask({ id: "first", parentId: "parent", isCompleted: true });
    const second = createTask({ id: "second", parentId: "parent", isCompleted: true });
    const { manager, getSaves } = managerFor([parent, first, second]);

    await manager.completeAncestorsIfReady("parent");

    expect(parent.isCompleted).toBe(true);
    expect(parent.completedAt).not.toBeNull();
    expect(getSaves()).toBe(1);
  });

  it("uncompletes ancestors when a child becomes incomplete", async () => {
    const parent = createTask({ id: "parent", isCompleted: true, completedAt: "2026-01-01T00:00:00.000Z" });
    const child = createTask({ id: "child", parentId: "parent" });
    const { manager } = managerFor([parent, child]);

    await manager.uncompleteAncestors("parent");

    expect(parent.isCompleted).toBe(false);
    expect(parent.completedAt).toBeNull();
  });
});
