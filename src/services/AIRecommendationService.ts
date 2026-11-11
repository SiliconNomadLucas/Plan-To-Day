import type { Task, MyDayGroup } from "../models/Task";
import { extractLocalDate } from "../utils/recurrence";
import { getPeriodKeyForDate } from "../utils/period";

export type PlanningIntensity = "light" | "balanced" | "high";

export interface AIRecommendation {
  id: string;
  title: string;
  note: string;
  listId: string;
  tags: string[];
  isImportant: boolean;
  durationMinutes: number;
  myDayGroup?: MyDayGroup;
  startDate?: string | null;
  dueDate?: string | null;
  parentId?: string;
  sourceTaskId?: string;
  reason?: string;
  warning?: string;
}

export interface RecommendationContext {
  tasks: Task[];
  date?: string;
  intensity: PlanningIntensity;
}

export interface AIProvider {
  recommendMyDay(context: RecommendationContext): Promise<AIRecommendation[]>;
}

const CAPACITY: Record<PlanningIntensity, number> = {
  light: 240,
  balanced: 360,
  high: 480,
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function estimateDuration(task: Pick<Task, "title" | "note">): number {
  const text = (task.title + " " + task.note).toLowerCase();
  if (/五小时|5小时|半天|全天|multiple clients|客户|项目|研究|深度|报告|搬家|travel/.test(text)) return 300;
  if (/运动|跑步|健身|workout|exercise/.test(text)) return 60;
  if (/会议|沟通|电话|meeting|call/.test(text)) return 45;
  if (/整理|收拾|回复|邮件|email|clean|review/.test(text)) return 30;
  return 60;
}

function groupForTitle(title: string): MyDayGroup {
  const text = title.toLowerCase();
  if (/运动|跑步|健身|exercise|workout/.test(text)) return "afternoon";
  if (/整理|收拾|回复|邮件|email|行政/.test(text)) return "evening";
  if (/会议|沟通|电话|meeting|call/.test(text)) return "afternoon";
  return "morning";
}

function toDateOnly(date: Date): string {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function addDays(date: string, days: number): string {
  const parts = date.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return toDateOnly(d);
}

function isSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

export class LocalAIProvider implements AIProvider {
  async recommendMyDay(context: RecommendationContext): Promise<AIRecommendation[]> {
    const date = context.date ?? toDateOnly(new Date());
    const selectedDate = new Date(date + "T12:00:00");
    const selectedWeek = getPeriodKeyForDate(selectedDate, "week");
    const current = context.tasks.filter((task) => !task.isDeleted && !task.isCompleted);
    const taskDate = (task: Task): string | null => task.dueDate ? extractLocalDate(task.dueDate) : task.startDate ? extractLocalDate(task.startDate) : null;
    const existing = current.filter((task) => !task.planKind && taskDate(task) === date);
    const capacity = CAPACITY[context.intensity];
    let used = existing.reduce((sum, task) => sum + estimateDuration(task), 0);
    const result: AIRecommendation[] = [];
    const weeklyGoals = current.filter((task) =>
      task.planKind === "week" &&
      task.planPeriodKey === selectedWeek &&
      task.status === "active" &&
      !existing.some((dailyTask) => isSimilar(dailyTask.title, task.title)),
    );
    const ordinaryTasks = current.filter((task) =>
      !task.planKind && taskDate(task) !== date,
    );
    const sorted = [...weeklyGoals, ...ordinaryTasks]
      .sort((a, b) => {
        const weeklyGoalPriority = Number(b.planKind === "week") - Number(a.planKind === "week");
        if (weeklyGoalPriority) return weeklyGoalPriority;
        const importance = Number(b.isImportant) - Number(a.isImportant);
        if (importance) return importance;
        const ad = a.dueDate ? extractLocalDate(a.dueDate) : "9999-99-99";
        const bd = b.dueDate ? extractLocalDate(b.dueDate) : "9999-99-99";
        return ad.localeCompare(bd);
      });
    for (const task of sorted) {
      if (result.length >= 10) break;
      const duration = estimateDuration(task);
      const segmentCount = Math.max(1, Math.ceil(duration / 90));
      const exceedsCapacity = used + Math.min(duration, 90) > capacity;
      const isWeeklyGoal = task.planKind === "week";
      if (exceedsCapacity && !isWeeklyGoal) continue;
      const group = groupForTitle(task.title);
      for (let segment = 0; segment < segmentCount && result.length < 10; segment++) {
        const segmentDate = addDays(date, segment);
        const segmentMinutes = Math.min(90, duration - segment * 90);
        const title = segmentCount > 1 ? `${task.title} · ${segment + 1}/${segmentCount}` : task.title;
        const warnings = [];
        if (segmentCount > 1) warnings.push("长任务已拆分为连续日任务。");
        if (isWeeklyGoal && exceedsCapacity) warnings.push("加入后可能超过每日建议容量。");
        result.push({
          id: crypto.randomUUID(), title, note: task.note, listId: task.listId, tags: [...task.tags],
          isImportant: task.isImportant, durationMinutes: segmentMinutes, myDayGroup: group,
          startDate: segmentDate + (group === "morning" ? "T09:00:00" : group === "afternoon" ? "T14:00:00" : "T18:00:00"),
          dueDate: segmentDate + (group === "morning" ? "T10:00:00" : group === "afternoon" ? "T15:00:00" : "T19:00:00"),
          parentId: isWeeklyGoal ? task.id : task.parentId,
          sourceTaskId: segmentCount === 1 && !isWeeklyGoal ? task.id : undefined,
          reason: isWeeklyGoal ? "本周目标可转为今天的普通任务" : task.isImportant ? "重要任务优先" : "根据截止日期和未完成状态推荐",
          warning: warnings.length ? warnings.join(" ") : undefined,
        });
      }
      used += Math.min(duration, 90);
    }
    return result;
  }

}

export function validateRecommendation(item: AIRecommendation): string | null {
  if (!item.title.trim()) return "任务标题不能为空";
  if (item.durationMinutes <= 0 || item.durationMinutes > 1440) return "任务时长不合法";
  for (const value of [item.startDate, item.dueDate]) {
    if (value && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "日期格式不合法";
  }
  return null;
}

export { CAPACITY, estimateDuration, isSimilar, addDays };
