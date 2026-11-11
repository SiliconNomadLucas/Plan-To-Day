import type { Task } from "../models/Task";
import type { TodoPluginLike } from "./TodoView";
import { extractLocalDate } from "../utils/recurrence";
import { getLunarDisplayText, isLunarSpecialDay } from "../utils/lunar";
import { isEnglish } from "../i18n";
import { setIcon } from "obsidian";
import { layoutOverlappingTasks } from "../utils/schedule";

export interface ScheduleDateState {
  year: number;
  month: number;
  date: number;
}

export type ScheduleScrollTarget = "now" | { taskId: string } | "preserve";

export interface ScheduleRendererCallbacks {
  getTaskBlockColor: (task: Task) => string;
  getContrastColor: (hex: string) => string;
  isVisibleInSchedule: (task: Task, view: "day" | "week" | "month") => boolean;
  isAllDayTask: (task: Task) => boolean;
  openTask: (taskId: string) => void;
  renderTimedTaskCard: (container: HTMLElement, task: Task) => void;
  startAllDayDrag: (event: MouseEvent, task: Task, card: HTMLElement, grid: HTMLDivElement, dateStr: string) => void;
  startWeekAllDayDrag: (event: MouseEvent, task: Task, card: HTMLElement, grid: HTMLDivElement, weekStart: Date, columnIndex: number) => void;
  isDragging: () => boolean;
  wasLastDragMoved: () => boolean;
  promptTitle: () => Promise<string | null>;
  createTask: (fields: Partial<Task>) => Promise<void>;
  rerender: () => void;
  renderTimeline: (grid: HTMLElement) => void;
  snapMinute: (pixels: number, hourHeight: number) => number;
  minuteToIso: (dateStr: string, minute: number) => string;
  getScrollTarget: () => ScheduleScrollTarget;
  consumeScrollTarget: () => void;
}

export class ScheduleRenderer {
  constructor(
    private readonly plugin: TodoPluginLike,
    private readonly callbacks: ScheduleRendererCallbacks,
  ) {}

  renderMonth(container: HTMLDivElement, state: ScheduleDateState): void {
    const weekdays = isEnglish() ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "一", "二", "三", "四", "五", "六"];
    const weekdaysEl = container.createDiv({ cls: "todo-schedule-weekdays" });
    for (const weekday of weekdays) weekdaysEl.createSpan({ text: weekday });

    const grid = container.createDiv({ cls: "todo-schedule-grid" });
    const firstDay = new Date(state.year, state.month, 1);
    const startDow = firstDay.getDay();
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    grid.style.setProperty("--schedule-rows", String(totalCells / 7));

    const prevMonthDays = new Date(state.year, state.month, 0).getDate();
    const today = new Date();
    const todayStr = formatDate(today);
    for (let index = 0; index < totalCells; index++) {
      const cellDate = this.getCellDate(state, index, startDow, daysInMonth, prevMonthDays);
      const cell = grid.createDiv({
        cls: "todo-schedule-cell",
        attr: { "data-date-str": cellDate.date },
      });
      if (cellDate.otherMonth) cell.addClass("todo-schedule-other-month");
      if (cellDate.date === todayStr) cell.addClass("todo-schedule-today");
      if (index % 7 === 0 || index % 7 === 6) cell.addClass("todo-schedule-weekend");
      cell.createDiv({ cls: "todo-schedule-cell-date", text: String(cellDate.day) });

      if (!isEnglish() && this.plugin.settings.showLunarCalendar) {
        const [year, month, day] = cellDate.date.split("-").map(Number);
        const lunarText = getLunarDisplayText(year, month, day);
        const lunarClass = "todo-schedule-cell-lunar" + (isLunarSpecialDay(year, month, day) ? " todo-lunar-festival" : "");
        cell.createSpan({ cls: lunarClass, text: lunarText });
      }
      cell.createDiv({ cls: "todo-schedule-cell-tasks" });
    }

    const tasks = this.plugin.taskService.getAll()
      .filter((task) => this.callbacks.isVisibleInSchedule(task, "month") && task.dueDate);
    for (const task of tasks) {
      const taskDate = extractLocalDate(task.dueDate!);
      const target = grid.querySelector(`[data-date-str="${taskDate}"] .todo-schedule-cell-tasks`) as HTMLElement | null;
      if (!target) continue;
      const color = this.callbacks.getTaskBlockColor(task);
      const card = target.createDiv({ cls: "todo-month-task-card" + (task.isCompleted ? " todo-schedule-completed" : "") });
      card.style.backgroundColor = color;
      card.style.color = this.callbacks.getContrastColor(color);
      card.createSpan({ cls: "todo-month-task-title", text: task.title });
      if (task.recurrence) {
        const recurrenceIcon = card.createSpan({ cls: "todo-month-task-rec" });
        setIcon(recurrenceIcon, "repeat");
      }
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.openTask(task.id);
      });
    }
  }

  renderDay(container: HTMLDivElement, state: ScheduleDateState): void {
    const hourHeight = 60;
    const dateStr = formatDate(new Date(state.year, state.month, state.date));
    const allTasks = this.plugin.taskService.getAll();
    const dayTasks = allTasks.filter((task) =>
      this.callbacks.isVisibleInSchedule(task, "day")
      && task.dueDate
      && extractLocalDate(task.dueDate) === dateStr
      && !this.callbacks.isAllDayTask(task),
    );
    const view = container.createDiv({ cls: "todo-schedule-day-view" });
    const allday = view.createDiv({ cls: "todo-day-allday" });
    allday.createSpan({ cls: "todo-day-allday-label", text: isEnglish() ? "All day" : "全天" });

    const alldayTasks = allTasks.filter((task) =>
      this.callbacks.isVisibleInSchedule(task, "day")
      && task.dueDate
      && extractLocalDate(task.dueDate) === dateStr
      && this.callbacks.isAllDayTask(task),
    );
    let gridEl: HTMLDivElement;
    for (const task of alldayTasks) {
      const color = this.callbacks.getTaskBlockColor(task);
      const card = allday.createDiv({ cls: "todo-day-allday-card" + (task.isCompleted ? " todo-schedule-completed" : "") });
      card.style.backgroundColor = color;
      card.style.color = this.callbacks.getContrastColor(color);
      card.createSpan({ text: task.title });
      card.addEventListener("mousedown", (event) => {
        if (event.button === 0) this.callbacks.startAllDayDrag(event, task, card, gridEl, dateStr);
      });
      card.addEventListener("click", () => {
        if (this.callbacks.isDragging() || this.callbacks.wasLastDragMoved()) return;
        this.callbacks.openTask(task.id);
      });
    }

    gridEl = view.createDiv({ cls: "todo-time-grid" });
    const slots = gridEl.createDiv({ cls: "todo-time-slots" });
    for (let hour = 0; hour < 24; hour++) slots.createDiv({ cls: "todo-time-slot" });
    const labels = gridEl.createDiv({ cls: "todo-time-labels" });
    for (let hour = 0; hour <= 24; hour++) labels.createDiv({ cls: "todo-time-label", text: String(hour).padStart(2, "0") + ":00" });

    const eventsContainer = gridEl.createDiv({ cls: "todo-time-events" });
    const placements = layoutOverlappingTasks(dayTasks);
    for (const placement of placements) {
      const start = new Date(placement.task.startDate!).getHours() * 60 + new Date(placement.task.startDate!).getMinutes();
      const end = new Date(placement.task.dueDate!).getHours() * 60 + new Date(placement.task.dueDate!).getMinutes();
      if (end < start) continue;
      this.callbacks.renderTimedTaskCard(eventsContainer, placement.task);
      const card = eventsContainer.lastElementChild as HTMLElement;
      card.style.top = (start / 60) * hourHeight + "px";
      card.style.height = Math.max(((end - start) / 60) * hourHeight, 20) + "px";
      const width = 100 / placement.totalCols;
      card.style.width = `calc(${width}% - 3px)`;
      card.style.left = `calc(${width * placement.col}% + ${placement.col * 3}px)`;
    }

    eventsContainer.addEventListener("click", async (event) => {
      if (this.callbacks.isDragging() || this.callbacks.wasLastDragMoved() || event.target !== eventsContainer) return;
      const rect = eventsContainer.getBoundingClientRect();
      const startMinute = this.callbacks.snapMinute(rect ? event.clientY - rect.top + gridEl.scrollTop : 0, hourHeight);
      const endMinute = Math.min(1440, startMinute + 60);
      const title = await this.callbacks.promptTitle();
      if (!title) return;
      const defaultList = this.plugin.listService.getDefault();
      if (!defaultList) return;
      await this.callbacks.createTask({
        title,
        listId: defaultList.id,
        startDate: this.callbacks.minuteToIso(dateStr, startMinute),
        dueDate: this.callbacks.minuteToIso(dateStr, endMinute),
      });
      this.callbacks.rerender();
    });

    this.callbacks.renderTimeline(gridEl);
    const scrollTarget = this.callbacks.getScrollTarget();
    if (scrollTarget === "now") {
      gridEl.scrollTop = Math.max(0, (new Date().getHours() - 1) * hourHeight);
    } else if (scrollTarget !== "preserve") {
      gridEl.querySelector<HTMLElement>(`[data-task-id="${scrollTarget.taskId}"]`)?.scrollIntoView({ block: "center" });
    }
    this.callbacks.consumeScrollTarget();
  }

  renderWeek(container: HTMLDivElement, state: ScheduleDateState): void {
    const hourHeight = 60;
    const referenceDate = new Date(state.year, state.month, state.date);
    const dayOfWeek = referenceDate.getDay() || 7;
    const weekStart = new Date(referenceDate);
    weekStart.setDate(referenceDate.getDate() - dayOfWeek + 1);
    const weekdays = isEnglish() ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const today = new Date();
    const todayStr = formatDate(today);
    const view = container.createDiv({ cls: "todo-schedule-week-view" });
    const grid = view.createDiv({ cls: "todo-schedule-week-grid" });
    const thead = grid.createDiv({ cls: "todo-week-thead" });
    const header = thead.createDiv({ cls: "todo-week-header" });
    header.createDiv({ cls: "todo-week-corner" });

    for (let index = 0; index < 7; index++) {
      const date = addDays(weekStart, index);
      const dateStr = formatDate(date);
      const isToday = dateStr === todayStr;
      const column = header.createDiv({ cls: "todo-week-day-header" + (isToday ? " todo-week-today-col" : "") });
      column.createDiv({ cls: "todo-week-dow", text: weekdays[index] });
      const dateNumber = column.createDiv({ cls: "todo-week-date-num", text: String(date.getDate()) });
      if (isToday) dateNumber.addClass("todo-schedule-today");
      if (!isEnglish() && this.plugin.settings.showLunarCalendar) {
        const lunarText = getLunarDisplayText(date.getFullYear(), date.getMonth() + 1, date.getDate());
        const lunarClass = "todo-week-lunar" + (isLunarSpecialDay(date.getFullYear(), date.getMonth() + 1, date.getDate()) ? " todo-lunar-festival" : "");
        column.createSpan({ cls: lunarClass, text: lunarText });
      }
    }

    const allTasks = this.plugin.taskService.getAll();
    const allDayTasks = allTasks.filter((task) => this.callbacks.isVisibleInSchedule(task, "week") && task.dueDate && this.callbacks.isAllDayTask(task));
    const allDayRow = thead.createDiv({ cls: "todo-week-allday" });
    allDayRow.createDiv({ cls: "todo-week-allday-label", text: isEnglish() ? "All day" : "全天" });
    for (let index = 0; index < 7; index++) {
      const date = addDays(weekStart, index);
      const dateStr = formatDate(date);
      const cell = allDayRow.createDiv({ cls: "todo-week-allday-cell" + (dateStr === todayStr ? " todo-week-today-col" : "") });
      for (const task of allDayTasks.filter((item) => extractLocalDate(item.dueDate!) === dateStr)) {
        const color = this.callbacks.getTaskBlockColor(task);
        const card = cell.createDiv({ cls: "todo-day-allday-card" + (task.isCompleted ? " todo-schedule-completed" : "") });
        card.style.backgroundColor = color;
        card.style.color = this.callbacks.getContrastColor(color);
        card.createSpan({ text: task.title });
        card.addEventListener("mousedown", (event) => {
          if (event.button === 0) this.callbacks.startWeekAllDayDrag(event, task, card, grid, weekStart, index);
        });
        card.addEventListener("click", () => {
          if (this.callbacks.isDragging() || this.callbacks.wasLastDragMoved()) return;
          this.callbacks.openTask(task.id);
        });
      }
    }

    const body = grid.createDiv({ cls: "todo-week-tbody" });
    const todayColumn = today.getDay() === 0 ? 6 : today.getDay() - 1;
    for (let hour = 0; hour < 24; hour++) {
      const row = body.createDiv({ cls: "todo-week-grid-row" });
      row.createDiv({ cls: "todo-week-time-cell" });
      for (let index = 0; index < 7; index++) {
        row.createDiv({ cls: "todo-week-day-cell" + (index === todayColumn ? " todo-week-today-col" : "") });
      }
    }
    const labels = body.createDiv({ cls: "todo-time-labels" });
    for (let hour = 0; hour <= 24; hour++) labels.createDiv({ cls: "todo-time-label", text: String(hour).padStart(2, "0") + ":00" });

    const columns = body.createDiv({ cls: "todo-week-columns" });
    for (let index = 0; index < 7; index++) {
      const dateStr = formatDate(addDays(weekStart, index));
      const column = columns.createDiv({ cls: "todo-week-column" });
      const dayTasks = allTasks.filter((task) =>
        this.callbacks.isVisibleInSchedule(task, "week")
        && task.startDate
        && task.dueDate
        && extractLocalDate(task.dueDate) === dateStr
        && !this.callbacks.isAllDayTask(task),
      );
      for (const placement of layoutOverlappingTasks(dayTasks)) {
        const start = new Date(placement.task.startDate!).getHours() * 60 + new Date(placement.task.startDate!).getMinutes();
        const end = new Date(placement.task.dueDate!).getHours() * 60 + new Date(placement.task.dueDate!).getMinutes();
        if (end < start) continue;
        this.callbacks.renderTimedTaskCard(column, placement.task);
        const card = column.lastElementChild as HTMLElement;
        card.dataset.dateStr = dateStr;
        card.style.top = (start / 60) * hourHeight + "px";
        card.style.height = Math.max(((end - start) / 60) * hourHeight, 18) + "px";
        const width = 100 / placement.totalCols;
        card.style.width = `calc(${width}% - 3px)`;
        card.style.left = `calc(${width * placement.col}% + ${placement.col * 3}px)`;
      }
      column.addEventListener("click", async (event) => {
        if (this.callbacks.isDragging() || this.callbacks.wasLastDragMoved() || event.target !== column) return;
        const rect = column.getBoundingClientRect();
        const startMinute = this.callbacks.snapMinute(event.clientY - rect.top, hourHeight);
        const title = await this.callbacks.promptTitle();
        if (!title) return;
        const defaultList = this.plugin.listService.getDefault();
        if (!defaultList) return;
        await this.callbacks.createTask({
          title,
          listId: defaultList.id,
          startDate: this.callbacks.minuteToIso(dateStr, startMinute),
          dueDate: this.callbacks.minuteToIso(dateStr, Math.min(1440, startMinute + 60)),
        });
        this.callbacks.rerender();
      });
    }

    this.callbacks.renderTimeline(body);
    const scrollTarget = this.callbacks.getScrollTarget();
    if (scrollTarget === "now") {
      grid.scrollTop = Math.max(0, (today.getHours() - 1) * hourHeight);
    } else if (scrollTarget !== "preserve") {
      grid.querySelector<HTMLElement>(`[data-task-id="${scrollTarget.taskId}"]`)?.scrollIntoView({ block: "center" });
    }
    this.callbacks.consumeScrollTarget();
  }

  private getCellDate(
    state: ScheduleDateState,
    index: number,
    startDow: number,
    daysInMonth: number,
    prevMonthDays: number,
  ): { date: string; day: number; otherMonth: boolean } {
    if (index < startDow) {
      const month = state.month === 0 ? 11 : state.month - 1;
      const year = state.month === 0 ? state.year - 1 : state.year;
      const day = prevMonthDays - startDow + index + 1;
      return { date: formatDate(new Date(year, month, day)), day, otherMonth: true };
    }
    if (index >= startDow + daysInMonth) {
      const month = state.month === 11 ? 0 : state.month + 1;
      const year = state.month === 11 ? state.year + 1 : state.year;
      const day = index - startDow - daysInMonth + 1;
      return { date: formatDate(new Date(year, month, day)), day, otherMonth: true };
    }
    const day = index - startDow + 1;
    return { date: formatDate(new Date(state.year, state.month, day)), day, otherMonth: false };
  }
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
