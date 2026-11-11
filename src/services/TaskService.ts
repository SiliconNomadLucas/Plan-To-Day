import { Vault } from "obsidian";
import { Task, PlanKind, createTask } from "../models/Task";
import { PersistentJsonService } from "./PersistentJsonService";
import { logger } from "../utils/logger";
import { localTodayStr } from "../utils/period";
import { extractLocalDate } from "../utils/recurrence";
import type { RecurrenceSeriesService } from "./RecurrenceSeriesService";
import { RecurrenceTaskManager } from "./RecurrenceTaskManager";
import { TaskHierarchyManager } from "./TaskHierarchyManager";
import {
  CURRENT_TASK_SCHEMA_VERSION,
  migrateTaskDatabase,
  type VersionedTaskDatabase,
} from "./TaskDatabaseMigrations";

export type TaskDatabase = VersionedTaskDatabase;

export interface TaskStats {
  total: number;
  active: number;
  completed: number;
  deleted: number;
}

const DB_FILENAME = "database.json";

export class TaskService extends PersistentJsonService {
  private tasks: Task[] = [];
  private recurrenceManager: RecurrenceTaskManager;
  private hierarchyManager: TaskHierarchyManager;
  private backupFailureNotified = false;
  private notifyBackupFailure?: () => void;

  constructor(
    vault: Vault,
    folder: string,
    recurrenceSeriesService?: RecurrenceSeriesService,
    notifyBackupFailure?: () => void,
  ) {
    super(vault, folder);
    this.notifyBackupFailure = notifyBackupFailure;
    this.recurrenceManager = new RecurrenceTaskManager(
      () => this.tasks,
      (tasks) => { this.tasks = tasks; },
      () => this.save(),
      recurrenceSeriesService,
    );
    this.hierarchyManager = new TaskHierarchyManager(() => this.tasks, () => this.save());
  }

  async init(): Promise<void> {
    await this.initializeStore<unknown>(DB_FILENAME, async (db) => {
      if (db !== null) {
        const migration = migrateTaskDatabase(db);
        this.tasks = migration.tasks;
        await this.recurrenceManager.migrateLegacySources();
        if (migration.changed) await this.save();
        logger.info("Loaded", this.tasks.length, "tasks");
      } else {
        this.tasks = [];
        logger.info("No existing tasks, starting fresh");
      }
    });
    if (this.tasks.length > 0) await this.recurrenceManager.ensureInstances();
  }

  // ===== 查询方法（默认排除已删除）=====

  getAll(): Task[] {
    this.ensureLoaded();
    return this.tasks.filter(t => !t.isDeleted && !t.isRecurrenceTemplate);
  }

  getAllIncludingDeleted(): Task[] {
    this.ensureLoaded();
    return [...this.tasks];
  }

  getById(id: string): Task | undefined {
    this.ensureLoaded();
    return this.tasks.find((t) => t.id === id);
  }

  getByListId(listId: string): Task[] {
    this.ensureLoaded();
    return this.tasks.filter((t) => t.listId === listId && !t.isDeleted && !t.isRecurrenceTemplate);
  }

  getMyDay(): Task[] {
    this.ensureLoaded();
    const today = localTodayStr();
    return this.tasks.filter((t) => this.taskLocalDate(t) === today && !t.isDeleted && !t.isRecurrenceTemplate);
  }

  getInbox(defaultListId: string): Task[] {
    this.ensureLoaded();
    return this.tasks.filter((t) => t.listId === defaultListId && !t.isDeleted && !t.isRecurrenceTemplate);
  }

  getByPlanKindAndPeriod(kind: PlanKind, periodKey: string): Task[] {
    this.ensureLoaded();
    return this.tasks.filter((t) => t.planKind === kind && t.planPeriodKey === periodKey && !t.isDeleted && !t.isRecurrenceTemplate);
  }

  getChildrenOf(parentId: string): Task[] {
    this.ensureLoaded();
    return this.tasks.filter((t) => t.parentId === parentId && !t.isDeleted && !t.isRecurrenceTemplate);
  }

  countChildren(parentId: string): number {
    this.ensureLoaded();
    return this.tasks.filter((t) => t.parentId === parentId && !t.isDeleted && !t.isRecurrenceTemplate).length;
  }

  getParentOf(taskId: string): Task | undefined {
    this.ensureLoaded();
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !task.parentId) return undefined;
    return this.tasks.find((t) => t.id === task.parentId);
  }

  // ===== 回收站相关 =====

  getDeleted(): Task[] {
    this.ensureLoaded();
    return this.tasks.filter(t => t.isDeleted);
  }

  // ===== CRUD 操作 =====

  async create(fields: Partial<Task>): Promise<Task> {
    this.ensureLoaded();
    const task = createTask(fields);
    this.tasks.push(task);
    await this.save();
    logger.info("Task created:", task.title);
    return task;
  }

  async update(id: string, changes: Partial<Task>): Promise<Task | null> {
    this.ensureLoaded();
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      logger.warn("Task not found:", id);
      return null;
    }
    this.tasks[index] = {
      ...this.tasks[index],
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    logger.info("Task updated:", id);

    // 联动更新：源任务日期变更时，重新生成未完成的重复实例
    const updated = this.tasks[index];
    if (updated.isRecurrenceSource && updated.recurrenceGroupId && (changes.startDate !== undefined || changes.dueDate !== undefined)) {
      const oldInstances = this.tasks.filter(
        t => t.recurrenceGroupId === updated.recurrenceGroupId && !t.isRecurrenceSource && !t.isCompleted && !t.isDeleted
      );
      const oldIds = new Set(oldInstances.map(inst => inst.id));
      this.tasks = this.tasks.filter(t => !oldIds.has(t.id));
      await this.recurrenceManager.regenerateAfterSourceDateChange(updated);
    }

    // 联动更新：父任务标签变更时，同步更新所有子任务
    if (changes.tags !== undefined) {
      this.hierarchyManager.cascadeTags(id, [...(changes.tags ?? [])]);
      await this.save();
    }

    // 联动更新：设置父任务时，继承父任务标签并级联到所有后代
    if (changes.parentId !== undefined) {
      const parentTask = changes.parentId ? this.tasks.find(t => t.id === changes.parentId && !t.isDeleted) : null;
      if (parentTask) {
        this.hierarchyManager.inheritParentTags(updated, parentTask.id);
        await this.save();
      }
    }

    if (changes.isCompleted === true) {
      await this.hierarchyManager.completeAncestorsIfReady(updated.parentId);
    } else if (changes.isCompleted === false) {
      await this.hierarchyManager.uncompleteAncestors(updated.parentId);
    }

    return this.tasks[index];
  }

  /** 将重复任务当前实例的时间同步到未来未完成实例，保留每个实例自己的日期。 */
  async syncRecurrenceSchedule(taskId: string, startDate: string | null, dueDate: string | null): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.syncSchedule(taskId, startDate, dueDate);
  }

  /** 将重复任务的系列属性同步到未来未完成实例，不修改每个实例自己的日期或完成状态。 */
  async syncRecurrenceProperties(taskId: string, changes: Partial<Task>): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.syncProperties(taskId, changes);
  }

  async complete(id: string): Promise<Task | null> {
    this.ensureLoaded();
    const task = this.tasks.find(t => t.id === id);
    if (!task) return null;

    const result = await this.update(id, {
      isCompleted: true,
      completedAt: new Date().toISOString(),
    });

    // 重复实例完成后自动补充
    if (task.recurrence && task.recurrenceGroupId && !task.isRecurrenceSource) {
      await this.recurrenceManager.replenishInstances(task.recurrenceGroupId);
    }

    return result;
  }

  async uncomplete(id: string): Promise<Task | null> {
    return this.update(id, {
      isCompleted: false,
      completedAt: null,
    });
  }

  // 软删除
  async delete(id: string): Promise<boolean> {
    this.ensureLoaded();
    const task = this.tasks.find((t) => t.id === id);
    if (!task) {
      logger.warn("Task not found for delete:", id);
      return false;
    }
    const now = new Date().toISOString();
    task.isDeleted = true;
    task.deletedAt = now;
    task.updatedAt = now;
    // 软删除子任务
    const children = this.tasks.filter((t) => t.parentId === id && !t.isDeleted);
    for (const child of children) {
      await this.delete(child.id);
    }
    await this.save();
    logger.info("Task soft deleted:", task.title);
    return true;
  }

  // 恢复任务
  async restore(id: string): Promise<boolean> {
    this.ensureLoaded();
    const task = this.tasks.find((t) => t.id === id);
    if (!task || !task.isDeleted) {
      logger.warn("Task not found or not deleted:", id);
      return false;
    }
    task.isDeleted = false;
    task.deletedAt = null;
    task.updatedAt = new Date().toISOString();
    await this.save();
    logger.info("Task restored:", task.title);
    return true;
  }

  // 清空回收站
  async emptyTrash(): Promise<number> {
    this.ensureLoaded();
    const deletedTasks = this.tasks.filter(t => t.isDeleted);
    const count = deletedTasks.length;
    this.tasks = this.tasks.filter(t => !t.isDeleted);
    if (count > 0) {
      await this.save();
      logger.info("Trash emptied:", count, "tasks removed");
    }
    return count;
  }
  // 彻底删除任务（硬删除）
  async hardDelete(id: string): Promise<boolean> {
    this.ensureLoaded();
    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) {
      logger.warn("Task not found for hard delete:", id);
      return false;
    }
    const removed = this.tasks.splice(index, 1)[0];
    await this.save();
    logger.info("Task hard deleted:", removed.title);
    return true;
  }


  // 清空所有任务
  async clearAll(): Promise<number> {
    this.ensureLoaded();
    const count = this.tasks.length;
    this.tasks = [];
    if (count > 0) {
      await this.save();
      logger.info("All tasks cleared:", count);
    }
    return count;
  }


  // 获取数据统计
  getStats(): TaskStats {
    this.ensureLoaded();
    return {
      total: this.tasks.length,
      active: this.tasks.filter(t => !t.isDeleted && !t.isCompleted && !t.isRecurrenceTemplate).length,
      completed: this.tasks.filter(t => !t.isDeleted && t.isCompleted && !t.isRecurrenceTemplate).length,
      deleted: this.tasks.filter(t => t.isDeleted).length,
    };
  }

  // ===== 重复任务 =====

  private taskLocalDate(task: Task): string | null {
    return this.recurrenceManager.taskLocalDate(task);
  }

  /** 在视图打开或跨日刷新时调用，修复已经耗尽的重复实例窗口。 */
  async refreshRecurrenceInstances(): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.ensureInstances();
  }

  /** 设置重复规则。用户任务会转为内部模板，同时生成一个带日期的可执行实例。 */
  async setRecurrence(taskId: string, recurrence: string | null, endDate?: string | null): Promise<void> {
    this.ensureLoaded();
    return this.recurrenceManager.setRecurrence(taskId, recurrence, endDate);
  }

  /**
   * 补充重复实例（完成实例、启动插件或跨日刷新时调用）。
   * 始终保证从今天开始至少覆盖一个完整的预生成窗口，
   * 不依赖用户是否完成了足够多的旧实例。
   */
  async replenishInstances(groupId: string): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.replenishInstances(groupId);
  }

  /**
   * 获取重复组的所有实例（不含母任务）
   */
  getGroupInstances(groupId: string): Task[] {
    this.ensureLoaded();
    return this.recurrenceManager.getGroupInstances(groupId);
  }

  /** 获取所有重复系列源头任务 */
  getSources(): Task[] {
    this.ensureLoaded();
    return this.recurrenceManager.getSources();
  }

  /**
   * 删除整个重复系列
   * - 删除所有未完成实例（软删除）
   * - 保留已完成实例（用于统计）
   * - 删除母任务
   * @returns 删除的数量
   */
  async deleteSeries(groupId: string, taskId?: string): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.deleteSeries(groupId, taskId);
  }

  /**
   * 停止重复（保留已有实例，不再生成新的）
   */
  async stopRecurrence(groupId: string, fromTaskId?: string): Promise<number> {
    this.ensureLoaded();
    return this.recurrenceManager.stopRecurrence(groupId, fromTaskId);
  }


  private async save(): Promise<void> {
    const db: TaskDatabase = {
      schemaVersion: CURRENT_TASK_SCHEMA_VERSION,
      tasks: this.tasks,
    };
    const backupResult = await this.storage.backup(DB_FILENAME);
    if (backupResult === "failed") {
      if (!this.backupFailureNotified) {
        this.notifyBackupFailure?.();
        this.backupFailureNotified = true;
      }
    } else {
      this.backupFailureNotified = false;
    }
    await this.persistStore(DB_FILENAME, db);
  }

  private ensureLoaded(): void {
    this.ensureInitialized("TaskService");
  }
}
