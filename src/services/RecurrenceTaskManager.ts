import { Task, createTask } from "../models/Task";
import { createRecurrenceSeries } from "../models/RecurrenceSeries";
import type { RecurrenceSeriesService } from "./RecurrenceSeriesService";
import { getMyDayGroupFromTime } from "../utils/sort";
import { localTodayStr } from "../utils/period";
import {
  extractLocalDate,
  formatDateStr,
  getNextOccurrenceDate,
  getPreGenerateCount,
  parseLocalDate,
} from "../utils/recurrence";
import { logger } from "../utils/logger";

export class RecurrenceTaskManager {
  constructor(
    private readonly getTasks: () => Task[],
    private readonly replaceTasks: (tasks: Task[]) => void,
    private readonly save: () => Promise<void>,
    private readonly seriesService?: RecurrenceSeriesService,
  ) {}

  taskLocalDate(task: Task): string | null {
    if (task.dueDate) return extractLocalDate(task.dueDate);
    if (task.startDate) return extractLocalDate(task.startDate);
    return null;
  }

  async syncSchedule(taskId: string, startDate: string | null, dueDate: string | null): Promise<number> {
    const tasks = this.getTasks();
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.recurrenceGroupId || task.isRecurrenceTemplate) return 0;
    const currentDate = this.taskLocalDate(task);
    if (!currentDate) return 0;

    const timeOf = (value: string | null, fallback: string): string | null => {
      if (!value) return null;
      return value.includes("T") ? value.substring(value.indexOf("T")) : fallback;
    };
    const startTime = timeOf(startDate, "T07:00:00");
    const dueTime = timeOf(dueDate, "T23:30:00");
    let startOffsetDays = 0;
    if (startDate && dueDate) {
      const start = parseLocalDate(startDate);
      const due = parseLocalDate(dueDate);
      startOffsetDays = Math.round((Date.UTC(start.y, start.m, start.d) - Date.UTC(due.y, due.m, due.d)) / 86400000);
    }

    let count = 0;
    for (const instance of tasks) {
      if (instance.id === taskId || instance.recurrenceGroupId !== task.recurrenceGroupId || instance.isRecurrenceTemplate || instance.isDeleted || instance.isCompleted) continue;
      const instanceDate = this.taskLocalDate(instance);
      if (!instanceDate || instanceDate <= currentDate) continue;
      if (startDate === null) instance.startDate = null;
      else if (startTime) {
        const dueParts = parseLocalDate(instance.dueDate || instanceDate);
        const nextStart = new Date(dueParts.y, dueParts.m, dueParts.d + startOffsetDays);
        instance.startDate = formatDateStr(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate()) + startTime;
      }
      if (dueDate === null) instance.dueDate = null;
      else if (dueTime) instance.dueDate = (this.taskLocalDate(instance) || instanceDate) + dueTime;
      instance.updatedAt = new Date().toISOString();
      count++;
    }
    if (count > 0) await this.save();
    return count;
  }

  async syncProperties(taskId: string, changes: Partial<Task>): Promise<number> {
    const tasks = this.getTasks();
    const task = tasks.find((item) => item.id === taskId);
    if (!task || !task.recurrenceGroupId || task.isRecurrenceTemplate) return 0;
    const currentDate = this.taskLocalDate(task);
    if (!currentDate) return 0;

    const propertyChanges: Partial<Task> = {};
    const syncFields: Array<keyof Task> = [
      "title", "note", "listId", "tags", "isImportant", "status",
      "relatedPaths", "relatedFolders", "planKind", "planPeriodKey", "parentId",
    ];
    for (const field of syncFields) {
      if (changes[field] !== undefined) {
        const value = changes[field];
        (propertyChanges as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
      }
    }
    if (Object.keys(propertyChanges).length === 0) return 0;

    let count = 0;
    for (const instance of tasks) {
      if (instance.id === taskId || instance.recurrenceGroupId !== task.recurrenceGroupId || instance.isRecurrenceTemplate || instance.isDeleted || instance.isCompleted) continue;
      const instanceDate = this.taskLocalDate(instance);
      if (!instanceDate || instanceDate <= currentDate) continue;
      Object.assign(instance, propertyChanges);
      instance.updatedAt = new Date().toISOString();
      count++;
    }
    if (count > 0) await this.save();
    return count;
  }

  async migrateLegacySources(): Promise<void> {
    const tasks = this.getTasks();
    const today = localTodayStr();
    let changed = false;
    for (const source of tasks.filter((task) => task.isRecurrenceSource && !task.isRecurrenceTemplate && task.recurrence && task.recurrenceGroupId)) {
      source.isRecurrenceTemplate = true;
      changed = true;
      if (this.seriesService) {
        await this.seriesService.upsert(createRecurrenceSeries({
          id: source.recurrenceGroupId!,
          rule: source.recurrence!,
          startDate: this.taskLocalDate(source) || today,
          endDate: source.recurrenceEndDate,
          title: source.title,
          note: source.note,
          listId: source.listId,
          tags: [...source.tags],
          isImportant: source.isImportant,
        }));
      }
      const hasInstance = tasks.some((task) => task.recurrenceGroupId === source.recurrenceGroupId && !task.isRecurrenceTemplate && !task.isDeleted && this.taskLocalDate(task) !== null);
      if (!hasInstance) {
        const date = this.taskLocalDate(source) || today;
        tasks.push(createTask({
          ...source,
          id: crypto.randomUUID(),
          isRecurrenceTemplate: false,
          isRecurrenceSource: false,
          isCompleted: false,
          completedAt: null,
          startDate: source.startDate || date + "T07:00:00",
          dueDate: source.dueDate || date + "T23:30:00",
        }));
      }
    }
    if (changed) await this.save();
  }

  async ensureInstances(): Promise<number> {
    let created = 0;
    const groups = new Set(this.getTasks()
      .filter((task) => task.isRecurrenceSource && task.isRecurrenceTemplate && task.recurrence && task.recurrenceGroupId && !task.isDeleted)
      .map((task) => task.recurrenceGroupId as string));
    for (const groupId of groups) created += await this.replenishInstances(groupId);
    return created;
  }

  async setRecurrence(taskId: string, recurrence: string | null, endDate?: string | null): Promise<void> {
    const tasks = this.getTasks();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!recurrence) {
      task.recurrence = null;
      task.isRecurrenceSource = false;
      task.recurrenceEndDate = null;
      task.recurrenceGroupId = null;
      task.updatedAt = new Date().toISOString();
      await this.save();
      return;
    }

    const today = localTodayStr();
    if (!task.startDate && !task.dueDate) {
      task.startDate = today + "T07:00:00";
      task.dueDate = today + "T23:30:00";
    } else if (!task.dueDate) {
      task.dueDate = extractLocalDate(task.startDate!) + "T23:30:00";
    } else if (!task.startDate) {
      task.startDate = extractLocalDate(task.dueDate) + "T07:00:00";
    }

    if (task.recurrenceGroupId && task.recurrence !== recurrence) {
      const oldIds = new Set(tasks
        .filter((item) => item.recurrenceGroupId === task.recurrenceGroupId && !item.isRecurrenceSource && !item.isCompleted && !item.isDeleted)
        .map((item) => item.id));
      this.replaceTasks(tasks.filter((item) => !oldIds.has(item.id)));
    }

    const groupId = task.recurrenceGroupId || crypto.randomUUID();
    task.recurrence = recurrence;
    task.isRecurrenceSource = true;
    task.recurrenceGroupId = groupId;
    task.recurrenceEndDate = endDate !== undefined ? endDate : task.recurrenceEndDate;
    if (this.seriesService) {
      await this.seriesService.upsert(createRecurrenceSeries({
        id: groupId,
        rule: recurrence,
        startDate: extractLocalDate(task.dueDate),
        endDate: task.recurrenceEndDate,
        title: task.title,
        note: task.note,
        listId: task.listId,
        tags: [...task.tags],
        isImportant: task.isImportant,
      }));
    }
    task.updatedAt = new Date().toISOString();
    task.isRecurrenceTemplate = true;
    task.isRecurrenceSource = true;
    this.getTasks().push(createTask({
      ...task,
      id: crypto.randomUUID(),
      isRecurrenceTemplate: false,
      isRecurrenceSource: false,
      isCompleted: false,
      completedAt: null,
    }));
    await this.generateInstances(task);
  }

  async regenerateAfterSourceDateChange(task: Task): Promise<void> {
    const tasks = this.getTasks();
    if (!task.recurrenceGroupId) return;
    const oldIds = new Set(tasks
      .filter((item) => item.recurrenceGroupId === task.recurrenceGroupId && !item.isRecurrenceSource && !item.isCompleted && !item.isDeleted)
      .map((item) => item.id));
    this.replaceTasks(tasks.filter((item) => !oldIds.has(item.id)));
    await this.generateInstances(task);
  }

  private async generateInstances(template: Task): Promise<void> {
    if (!template.recurrence || !template.recurrenceGroupId) return;
    const tasks = this.getTasks();
    const count = getPreGenerateCount(template.recurrence);
    const templateDue = template.dueDate ? parseLocalDate(template.dueDate) : null;
    const baseLocal = templateDue ? new Date(templateDue.y, templateDue.m, templateDue.d) : new Date();
    let startOffsetDays = 0;
    if (template.startDate && template.dueDate) {
      const start = parseLocalDate(template.startDate);
      const end = parseLocalDate(template.dueDate);
      startOffsetDays = Math.round((new Date(start.y, start.m, start.d).getTime() - new Date(end.y, end.m, end.d).getTime()) / 86400000);
    }

    for (let index = 0; index < count; index++) {
      const nextDue = getNextOccurrenceDate(baseLocal, template.recurrence);
      baseLocal.setTime(nextDue.getTime());
      if (template.recurrenceEndDate) {
        const end = parseLocalDate(template.recurrenceEndDate);
        if (nextDue > new Date(end.y, end.m, end.d)) break;
      }
      const dueDateOnly = formatDateStr(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate());
      const isAllDayDue = !template.dueDate || !template.dueDate.includes("T") || template.dueDate.endsWith("T00:00:00") || template.dueDate.endsWith("T23:30:00");
      const dueTime = isAllDayDue ? "T23:30:00" : template.dueDate!.substring(template.dueDate!.indexOf("T"));
      let instanceStartDate: string;
      if (template.startDate) {
        const isAllDayStart = !template.startDate.includes("T") || template.startDate.endsWith("T00:00:00") || template.startDate.endsWith("T07:00:00");
        const startTime = isAllDayStart ? "T07:00:00" : template.startDate.substring(template.startDate.indexOf("T"));
        const startDate = new Date(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate() + startOffsetDays);
        instanceStartDate = formatDateStr(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()) + startTime;
      } else {
        instanceStartDate = dueDateOnly + "T07:00:00";
      }
      tasks.push(createTask({
        title: template.title,
        note: template.note,
        isImportant: template.isImportant,
        listId: template.listId,
        tags: [...template.tags],
        relatedPaths: [...template.relatedPaths],
        relatedFolders: [...template.relatedFolders],
        myDayGroup: getMyDayGroupFromTime(instanceStartDate, dueDateOnly + dueTime),
        recurrence: template.recurrence,
        recurrenceGroupId: template.recurrenceGroupId,
        recurrenceEndDate: template.recurrenceEndDate,
        isRecurrenceTemplate: false,
        dueDate: dueDateOnly + dueTime,
        startDate: instanceStartDate,
      }));
    }
    await this.save();
    logger.info("Generated recurrence instances for:", template.title);
  }

  async replenishInstances(groupId: string): Promise<number> {
    const tasks = this.getTasks();
    const instances = tasks.filter((task) => task.recurrenceGroupId === groupId && !task.isRecurrenceTemplate && !task.isDeleted);
    const source = tasks.find((task) => task.recurrenceGroupId === groupId && task.isRecurrenceSource && !task.isDeleted);
    if (!source?.recurrence) return 0;
    const totalCount = getPreGenerateCount(source.recurrence);
    const todayParts = parseLocalDate(localTodayStr());
    const targetDate = new Date(todayParts.y, todayParts.m, todayParts.d);
    for (let index = 1; index < totalCount; index++) targetDate.setTime(getNextOccurrenceDate(targetDate, source.recurrence).getTime());

    let latestDate: Date | null = null;
    for (const instance of instances) {
      if (!instance.dueDate) continue;
      const date = parseLocalDate(instance.dueDate);
      const candidate = new Date(date.y, date.m, date.d);
      if (!latestDate || candidate > latestDate) latestDate = candidate;
    }
    if (!latestDate) {
      const sourceDate = this.taskLocalDate(source);
      if (sourceDate) {
        const date = parseLocalDate(sourceDate);
        latestDate = new Date(date.y, date.m, date.d);
      } else {
        latestDate = new Date();
      }
    }
    if (latestDate >= targetDate) return 0;

    const existingDates = new Set(instances.map((instance) => this.taskLocalDate(instance)).filter((date): date is string => !!date));
    let startOffsetDays = 0;
    if (source.startDate && source.dueDate) {
      const start = parseLocalDate(source.startDate);
      const end = parseLocalDate(source.dueDate);
      startOffsetDays = Math.round((new Date(start.y, start.m, start.d).getTime() - new Date(end.y, end.m, end.d).getTime()) / 86400000);
    }
    let created = 0;
    while (latestDate < targetDate) {
      const nextDue = getNextOccurrenceDate(latestDate, source.recurrence);
      if (!Number.isFinite(nextDue.getTime()) || nextDue <= latestDate) break;
      latestDate.setTime(nextDue.getTime());
      if (source.recurrenceEndDate) {
        const end = parseLocalDate(source.recurrenceEndDate);
        if (nextDue > new Date(end.y, end.m, end.d)) break;
      }
      const dueDate = formatDateStr(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate());
      if (existingDates.has(dueDate)) continue;
      const isAllDayDue = !source.dueDate || !source.dueDate.includes("T") || source.dueDate.endsWith("T00:00:00") || source.dueDate.endsWith("T23:30:00");
      const dueTime = isAllDayDue ? "T23:30:00" : source.dueDate!.substring(source.dueDate!.indexOf("T"));
      let startDate: string;
      if (source.startDate) {
        const isAllDayStart = !source.startDate.includes("T") || source.startDate.endsWith("T00:00:00") || source.startDate.endsWith("T07:00:00");
        const startTime = isAllDayStart ? "T07:00:00" : source.startDate.substring(source.startDate.indexOf("T"));
        const start = new Date(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate() + startOffsetDays);
        startDate = formatDateStr(start.getFullYear(), start.getMonth(), start.getDate()) + startTime;
      } else {
        startDate = dueDate + "T07:00:00";
      }
      tasks.push(createTask({
        title: source.title,
        note: source.note,
        isImportant: source.isImportant,
        listId: source.listId,
        tags: [...source.tags],
        relatedPaths: [...source.relatedPaths],
        relatedFolders: [...source.relatedFolders],
        myDayGroup: getMyDayGroupFromTime(startDate, dueDate + dueTime),
        recurrence: source.recurrence,
        recurrenceGroupId: groupId,
        recurrenceEndDate: source.recurrenceEndDate,
        isRecurrenceTemplate: false,
        dueDate: dueDate + dueTime,
        startDate,
      }));
      existingDates.add(dueDate);
      created++;
    }
    if (created > 0) {
      await this.save();
      logger.info("Replenished instances for group:", groupId, "created:", created);
    }
    return created;
  }

  getGroupInstances(groupId: string): Task[] {
    return this.getTasks().filter((task) => task.recurrenceGroupId === groupId && !task.isRecurrenceTemplate && !task.isDeleted);
  }

  getSources(): Task[] {
    return this.getTasks().filter((task) => task.isRecurrenceSource && !task.isDeleted);
  }

  async deleteSeries(groupId: string, taskId?: string): Promise<number> {
    const tasks = this.getTasks();
    const now = new Date().toISOString();
    const today = localTodayStr();
    let count = 0;
    for (const task of tasks) {
      if (task.recurrenceGroupId !== groupId || task.isDeleted) continue;
      const date = this.taskLocalDate(task);
      if (task.id === taskId || task.isRecurrenceTemplate || !date || date >= today) {
        task.isDeleted = true;
        task.deletedAt = now;
        task.updatedAt = now;
        count++;
      }
    }
    if (count > 0) await this.save();
    await this.seriesService?.remove(groupId);
    logger.info("Deleted series:", groupId, "removed", count);
    return count;
  }

  async stopRecurrence(groupId: string, fromTaskId?: string): Promise<number> {
    const tasks = this.getTasks();
    const now = new Date().toISOString();
    const today = localTodayStr();
    const deletedIds = new Set<string>();
    for (const task of tasks) {
      if (task.recurrenceGroupId !== groupId || task.isRecurrenceTemplate || task.isDeleted) continue;
      const date = this.taskLocalDate(task);
      if (date && date > today) deletedIds.add(task.id);
    }
    if (deletedIds.size > 0) this.replaceTasks(tasks.filter((task) => !deletedIds.has(task.id)));
    const current = fromTaskId ? this.getTasks().find((task) => task.id === fromTaskId && !task.isDeleted) : undefined;
    if (current) {
      current.isRecurrenceSource = false;
      current.recurrence = null;
      current.recurrenceGroupId = null;
      current.recurrenceEndDate = null;
      current.updatedAt = now;
    }
    const source = this.getTasks().find((task) => task.recurrenceGroupId === groupId && task.isRecurrenceTemplate && !task.isDeleted);
    if (source) {
      source.isDeleted = true;
      source.deletedAt = now;
      source.updatedAt = now;
    }
    if (deletedIds.size > 0 || current || source) await this.save();
    await this.seriesService?.remove(groupId);
    logger.info("Stopped recurrence for group:", groupId, "deleted:", deletedIds.size);
    return deletedIds.size;
  }
}
