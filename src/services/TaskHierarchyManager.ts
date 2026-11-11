import type { Task } from "../models/Task";

export class TaskHierarchyManager {
  constructor(
    private readonly getTasks: () => Task[],
    private readonly save: () => Promise<void>,
  ) {}

  cascadeTags(taskId: string, tags: string[]): void {
    for (const child of this.childrenOf(taskId)) {
      child.tags = [...tags];
      child.updatedAt = new Date().toISOString();
      this.cascadeTags(child.id, tags);
    }
  }

  inheritParentTags(task: Task, parentId?: string): void {
    if (!parentId) return;
    const parent = this.getTasks().find((item) => item.id === parentId && !item.isDeleted && !item.isRecurrenceTemplate);
    if (!parent) return;
    task.tags = [...parent.tags];
    task.updatedAt = new Date().toISOString();
    this.cascadeTags(task.id, task.tags);
  }

  async completeAncestorsIfReady(parentId?: string): Promise<void> {
    let currentParentId = parentId;
    let changed = false;
    while (currentParentId) {
      const parent = this.findActive(currentParentId);
      if (!parent || parent.planKind === "life") break;
      const children = this.childrenOf(parent.id);
      if (children.length === 0 || children.some((child) => !child.isCompleted)) break;
      if (!parent.isCompleted) {
        parent.isCompleted = true;
        parent.completedAt = new Date().toISOString();
        parent.updatedAt = new Date().toISOString();
        changed = true;
      }
      currentParentId = parent.parentId;
    }
    if (changed) await this.save();
  }

  async uncompleteAncestors(parentId?: string): Promise<void> {
    let currentParentId = parentId;
    let changed = false;
    while (currentParentId) {
      const parent = this.findActive(currentParentId);
      if (!parent || parent.planKind === "life") break;
      if (parent.isCompleted) {
        parent.isCompleted = false;
        parent.completedAt = null;
        parent.updatedAt = new Date().toISOString();
        changed = true;
      }
      currentParentId = parent.parentId;
    }
    if (changed) await this.save();
  }

  private childrenOf(parentId: string): Task[] {
    return this.getTasks().filter((task) =>
      task.parentId === parentId && !task.isDeleted && !task.isRecurrenceTemplate
    );
  }

  private findActive(id: string): Task | undefined {
    return this.getTasks().find((task) => id === task.id && !task.isDeleted && !task.isRecurrenceTemplate);
  }
}
