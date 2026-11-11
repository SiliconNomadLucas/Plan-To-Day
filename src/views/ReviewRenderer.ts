import type { Task } from "../models/Task";
import type { TodoPluginLike } from "./TodoView";
import { extractLocalDate } from "../utils/recurrence";
import { getReviewRange, reviewDateToString, shiftReviewDate, type ReviewDateState, type ReviewMode } from "../utils/review";
import { buildMonthlyReviewTrend, buildTagDistribution, buildWeeklyReviewTrend } from "../utils/review-data";
import { isEnglish, systemTagName, t } from "../i18n";
import {
  renderDistributionBar,
  renderMonthCalendar,
  renderStatCard,
  renderStackedBarChart,
  renderYearHeatmap,
} from "../utils/chart";

type ReviewFilter = {
  type: "date" | "overdue" | "tag";
  value: string;
  label: string;
  dateField?: "dueDate" | "completedAt";
};

export class ReviewRenderer {
  constructor(
    private readonly plugin: TodoPluginLike,
    private readonly navigateWithFilter: (filter: ReviewFilter) => Promise<void>,
  ) {}

  render(container: HTMLDivElement, mode: ReviewMode, state: ReviewDateState): void {
    container.empty();
    const stickyHeader = container.parentElement?.querySelector<HTMLElement>(".todo-review-sticky-header");
    stickyHeader?.querySelectorAll<HTMLElement>(".todo-review-stats-row").forEach((el) => el.remove());

    switch (mode) {
      case "day":
        this.renderDay(container, state);
        break;
      case "week":
        this.renderWeek(container, state);
        break;
      case "month":
        this.renderMonth(container, state);
        break;
      case "year":
        this.renderYear(container, state);
        break;
    }

    const statsRow = container.querySelector<HTMLElement>(".todo-review-stats-row");
    if (statsRow && stickyHeader) stickyHeader.appendChild(statsRow);
  }

  private renderDistribution(container: HTMLElement, tasks: Task[], kind: "quadrant" | "domain", title: string): void {
    const allTags = this.plugin.tagService.getAll();
    const data = buildTagDistribution(tasks, allTags, kind).map((item) => ({
      label: item.name === "未分类"
        ? (isEnglish() ? "Uncategorized" : item.name)
        : systemTagName(allTags.find((tag) => tag.name === item.name) || { name: item.name, isDefault: false }),
      total: item.total,
      completed: item.completed,
      color: item.color,
    }));
    const section = container.createDiv({ cls: "todo-review-section" });
    section.createDiv({ cls: "todo-review-section-title", text: t(title) });
    renderDistributionBar(section, data);
  }

  private renderDay(container: HTMLDivElement, state: ReviewDateState): void {
    const dateStr = reviewDateToString(state);
    const stats = this.plugin.statsService.getDayStats(dateStr);
    const summary = this.plugin.statsService.getStatusSummary(dateStr, dateStr);
    const statsRow = container.createDiv({ cls: "todo-review-stats-row" });
    renderStatCard(statsRow, t("今日任务"), String(summary.total), "calendar-check", "#6D91B6", () => this.navigateWithFilter({ type: "date", value: dateStr, label: dateStr + " " + t("今日任务"), dateField: "dueDate" }));
    renderStatCard(statsRow, t("今日完成"), String(summary.completed), "check-circle-2", "#41B974", () => this.navigateWithFilter({ type: "date", value: dateStr, label: dateStr + " " + t("完成"), dateField: "completedAt" }));
    renderStatCard(statsRow, t("进行中"), String(summary.active), "timer", "#6D91B6");
    renderStatCard(statsRow, t("已搁置"), String(summary.shelved), "pause-circle", "#C19957");
    renderStatCard(statsRow, t("已放弃"), String(summary.abandoned), "x-circle", "#9AA1A1");
    renderStatCard(statsRow, t("完成率"), summary.completionRate + "%", "bar-chart-2", "#91719E");
    const yesterdayStr = reviewDateToString(shiftReviewDate(state, "day", -1));
    const yesterdayOverdue = this.plugin.statsService.getStatusSummary(yesterdayStr, yesterdayStr).overdue;
    renderStatCard(statsRow, t("昨日逾期"), String(yesterdayOverdue), "alert-triangle", "#BC6F67", () => this.navigateWithFilter({ type: "date", value: yesterdayStr, label: yesterdayStr + " " + t("逾期任务"), dateField: "dueDate" }));

    const todayTasks = this.plugin.taskService.getAll().filter((task) => task.dueDate && extractLocalDate(task.dueDate) === dateStr);
    this.renderDistribution(container, todayTasks, "quadrant", "四象限分布");
    this.renderDistribution(container, todayTasks, "domain", "领域分布");
  }

  private renderWeek(container: HTMLDivElement, state: ReviewDateState): void {
    const range = getReviewRange(state, "week");
    const weekYear = range.weekYear!;
    const week = range.week!;
    const stats = this.plugin.statsService.getWeekStats(weekYear, week);
    const summary = this.plugin.statsService.getStatusSummary(range.start, range.end);
    const statsRow = container.createDiv({ cls: "todo-review-stats-row" });
    renderStatCard(statsRow, t("本周任务"), String(summary.total), "calendar-check", "#6D91B6", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本周任务"), dateField: "dueDate" }));
    renderStatCard(statsRow, t("本周完成"), String(summary.completed), "check-circle-2", "#41B974", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本周完成"), dateField: "completedAt" }));
    renderStatCard(statsRow, t("进行中"), String(summary.active), "timer", "#6D91B6");
    renderStatCard(statsRow, t("已搁置"), String(summary.shelved), "pause-circle", "#C19957");
    renderStatCard(statsRow, t("已放弃"), String(summary.abandoned), "x-circle", "#9AA1A1");
    renderStatCard(statsRow, t("完成率"), summary.completionRate + "%", "bar-chart-2", "#91719E");
    renderStatCard(statsRow, t("逾期任务"), String(summary.overdue), "alert-triangle", "#BC6F67", () => this.navigateWithFilter({ type: "overdue", value: "", label: t("逾期任务") }));

    const dayLabels = isEnglish() ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const stackedData = stats.dailyTrend.map((item: { date: string; count: number; uncompleted: number }, index: number) => ({
      label: dayLabels[index] || item.date,
      segments: [
        { value: item.uncompleted, color: "#C8C8C8", label: t("未完成") },
        { value: item.count, color: "#41B974", label: t("完成") },
      ],
    }));
    const trendSection = container.createDiv({ cls: "todo-review-section" });
    trendSection.createDiv({ cls: "todo-review-section-title", text: t("每日任务趋势") });
    renderStackedBarChart(trendSection, stackedData);

    const weekTasks = this.tasksInRange(range.start, range.end);
    this.renderDistribution(container, weekTasks, "quadrant", "四象限分布");
    this.renderDistribution(container, weekTasks, "domain", "领域分布");
  }

  private renderMonth(container: HTMLDivElement, state: ReviewDateState): void {
    const stats = this.plugin.statsService.getMonthStats(state.year, state.month);
    const range = getReviewRange(state, "month");
    const summary = this.plugin.statsService.getStatusSummary(range.start, range.end);
    const statsRow = container.createDiv({ cls: "todo-review-stats-row" });
    renderStatCard(statsRow, t("本月任务"), String(summary.total), "calendar-check", "#6D91B6", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本月任务"), dateField: "dueDate" }));
    renderStatCard(statsRow, t("本月完成"), String(summary.completed), "check-circle-2", "#41B974", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本月完成"), dateField: "completedAt" }));
    renderStatCard(statsRow, t("进行中"), String(summary.active), "timer", "#6D91B6");
    renderStatCard(statsRow, t("已搁置"), String(summary.shelved), "pause-circle", "#C19957");
    renderStatCard(statsRow, t("已放弃"), String(summary.abandoned), "x-circle", "#9AA1A1");
    renderStatCard(statsRow, t("完成率"), summary.completionRate + "%", "bar-chart-2", "#91719E");
    renderStatCard(statsRow, t("逾期任务"), String(summary.overdue), "alert-triangle", "#BC6F67", () => this.navigateWithFilter({ type: "overdue", value: "", label: t("逾期任务") }));

    const calendarSection = container.createDiv({ cls: "todo-review-section" });
    calendarSection.createDiv({ cls: "todo-review-section-title", text: t("月度打卡") });
    renderMonthCalendar(calendarSection, state.year, state.month, stats.dailyTrend.map((item: { date: string; count: number }) => ({ date: item.date, count: item.count })));

    const weekStackedData = buildWeeklyReviewTrend(stats.dailyTrend, isEnglish()).map((item) => ({
      label: item.label,
      segments: [
        { value: item.uncompleted, color: "#C8C8C8", label: t("未完成") },
        { value: item.completed, color: "#41B974", label: t("完成") },
      ],
    }));
    if (weekStackedData.length > 0) {
      const weekSection = container.createDiv({ cls: "todo-review-section" });
      weekSection.createDiv({ cls: "todo-review-section-title", text: t("每周任务趋势") });
      renderStackedBarChart(weekSection, weekStackedData);
    }

    const monthTasks = this.tasksInRange(range.start, range.end);
    this.renderDistribution(container, monthTasks, "quadrant", "四象限分布");
    this.renderDistribution(container, monthTasks, "domain", "领域分布");
  }

  private renderYear(container: HTMLDivElement, state: ReviewDateState): void {
    const stats = this.plugin.statsService.getYearStats(state.year);
    const range = getReviewRange(state, "year");
    const summary = this.plugin.statsService.getStatusSummary(range.start, range.end);
    const statsRow = container.createDiv({ cls: "todo-review-stats-row" });
    renderStatCard(statsRow, t("本年任务"), String(summary.total), "calendar-check", "#6D91B6", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本年任务"), dateField: "dueDate" }));
    renderStatCard(statsRow, t("本年完成"), String(summary.completed), "check-circle-2", "#41B974", () => this.navigateWithFilter({ type: "date", value: range.start, label: t("本年完成"), dateField: "completedAt" }));
    renderStatCard(statsRow, t("进行中"), String(summary.active), "timer", "#6D91B6");
    renderStatCard(statsRow, t("已搁置"), String(summary.shelved), "pause-circle", "#C19957");
    renderStatCard(statsRow, t("已放弃"), String(summary.abandoned), "x-circle", "#9AA1A1");
    renderStatCard(statsRow, t("完成率"), summary.completionRate + "%", "bar-chart-2", "#91719E");
    renderStatCard(statsRow, t("逾期任务"), String(summary.overdue), "alert-triangle", "#BC6F67", () => this.navigateWithFilter({ type: "overdue", value: "", label: t("逾期任务") }));

    const heatSection = container.createDiv({ cls: "todo-review-section" });
    heatSection.createDiv({ cls: "todo-review-section-title", text: t("年度打卡") });
    renderYearHeatmap(heatSection, state.year, stats.dailyTrend.map((item: { date: string; count: number }) => ({ date: item.date, count: item.count })));

    const monthStackedData = buildMonthlyReviewTrend(stats.dailyTrend, state.year, isEnglish()).map((item) => ({
      label: item.label,
      segments: [
        { value: item.uncompleted, color: "#C8C8C8", label: t("未完成") },
        { value: item.completed, color: "#41B974", label: t("完成") },
      ],
    }));
    const monthSection = container.createDiv({ cls: "todo-review-section" });
    monthSection.createDiv({ cls: "todo-review-section-title", text: t("每月任务趋势") });
    renderStackedBarChart(monthSection, monthStackedData);

    const yearTasks = this.tasksInRange(range.start, range.end);
    this.renderDistribution(container, yearTasks, "quadrant", "四象限分布");
    this.renderDistribution(container, yearTasks, "domain", "领域分布");
  }

  private tasksInRange(start: string, end: string): Task[] {
    return this.plugin.taskService.getAll().filter((task) => {
      if (!task.dueDate) return false;
      const date = extractLocalDate(task.dueDate);
      return date >= start && date <= end;
    });
  }
}
