
class ConfirmModal extends Modal {
  private message: string;
  private confirmText: string;
  private warning: boolean;
  private resolve!: (value: boolean) => void;

  constructor(app: App, message: string, confirmText = "删除", warning = true) {
    super(app);
    this.message = t(message);
    this.confirmText = t(confirmText);
    this.warning = warning;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });

    const actions = contentEl.createDiv({ cls: "todo-prompt-actions" });
    const cancelBtn = actions.createEl("button", { text: t("取消") });
    const confirmBtn = actions.createEl("button", { text: this.confirmText, cls: this.warning ? "mod-warning" : "mod-cta" });

    cancelBtn.addEventListener("click", () => this.finish(false));
    confirmBtn.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  async openAndConfirm(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private finish(value: boolean): void {
    this.resolve(value);
    this.close();
  }
}

class PromptModal extends Modal {
  private promptText: string;
  private resolve!: (value: string | null) => void;
  private value = "";

  constructor(app: App, promptText: string) {
    super(app);
    this.promptText = t(promptText);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.promptText });

    const input = contentEl.createEl("input", { cls: "todo-prompt-input" });
    input.value = this.value;
    input.placeholder = this.promptText;
    input.addEventListener("input", () => {
      this.value = input.value;
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.resolveAndClose(input.value.trim());
      }
    });

    const actions = contentEl.createDiv({ cls: "todo-prompt-actions" });
    const cancelBtn = actions.createEl("button", { text: t("取消") });
    const confirmBtn = actions.createEl("button", { text: t("确认"), cls: "mod-cta" });

    cancelBtn.addEventListener("click", () => this.resolveAndClose(null));
    confirmBtn.addEventListener("click", () => this.resolveAndClose(input.value.trim()));

    window.setTimeout(() => input.focus(), 30);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  async openAndGetValue(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private resolveAndClose(value: string | null): void {
    this.resolve(value ?? null);
    this.close();
  }
}

class DateOnlyModal extends Modal {
  private resolve!: (value: string | null) => void;
  constructor(app: App, private initialDate: string) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("请选择日期") });
    const input = contentEl.createEl("input", { type: "date", cls: "todo-prompt-input" });
    input.value = this.initialDate;
    const actions = contentEl.createDiv({ cls: "todo-prompt-actions" });
    const cancel = actions.createEl("button", { text: t("取消") });
    const confirm = actions.createEl("button", { text: t("确认"), cls: "mod-cta" });
    cancel.addEventListener("click", () => { this.resolve(null); this.close(); });
    confirm.addEventListener("click", () => { const value = input.value; if (!value) return; this.resolve(value); this.close(); });
    window.setTimeout(() => input.focus(), 30);
  }
  onClose(): void { this.contentEl.empty(); }
  openAndGetValue(): Promise<string | null> { return new Promise((resolve) => { this.resolve = resolve; this.open(); }); }
}
import { App, ItemView, Menu, Modal, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import { Task, MyDayGroup, PlanKind } from "../models/Task";
import { extractLocalDate } from "../utils/recurrence";
import { localTodayStr, currentPeriodKey, getSubPeriodKeysForParent, getParentPeriodKey, getPeriodKeyForDate, getISOWeekNumber } from "../utils/period";
import { TaskDetailView, ScheduleSidebarItem } from "./TaskDetailView";
import type { RecurrenceSeriesService } from "../services/RecurrenceSeriesService";
import { AIRecommendationView } from "./AIRecommendationView";
import { TodoDetailSidebarView, VIEW_TYPE_TODO_DETAIL } from "./TodoDetailSidebarView";
import { sortTasks, getMyDayGroupFromTime } from "../utils/sort";
import type { SortConfig, SortField, SortDirection } from "../utils/sort";
import { IconPickerModal } from "../ui/IconPickerModal";
import { CreateListModal } from "../ui/CreateListModal";
import { isEnglish, localizeDom, systemTagName, t } from "../i18n";
import { LocalAIProvider, AIRecommendation, isSimilar, validateRecommendation } from "../services/AIRecommendationService";
import { isAllDayTask as isAllDayTaskRule, isVisibleInSchedule as isVisibleInScheduleRule, layoutOverlappingTasks } from "../utils/schedule";
import { localizedPeriodLabel as getLocalizedPeriodLabel, localizedSubGroupLabel as getLocalizedSubGroupLabel } from "../utils/plan-labels";
import { formatReviewTitle, reviewDateToString, shiftReviewDate, type ReviewMode, type ReviewDateState } from "../utils/review";
import { ReviewRenderer } from "./ReviewRenderer";
import { ScheduleRenderer } from "./ScheduleRenderer";
import { ScheduleDragController, type ScheduleDragState } from "./ScheduleDragController";
import { PlanGroupRenderer } from "./PlanGroupRenderer";
import { GoalDashboardRenderer } from "./GoalDashboardRenderer";
import { LifePlanRenderer } from "./LifePlanRenderer";
import { filterTasksByStatus, hideFutureRecurrenceInstances } from "../utils/task-list";
import type { ReviewStats } from "../services/StatsService";
import { openPluginSettings } from "../utils/obsidian-settings";
import { parseNavDragPayload } from "../utils/nav-drag";
import { reportAsyncError, runAsyncAction } from "../utils/async-action";

export type ViewNav = "myday" | "all" | "inbox" | "plan" | "schedule" | "review" | "trash";

export const VIEW_TYPE_TODO = "plan-to-day-view";



const MYDAY_GROUPS: { key: MyDayGroup; label: string }[] = [
  { key: "allday", label: "全天" },
  { key: "morning", label: "早上" },
  { key: "noon", label: "中午" },
  { key: "afternoon", label: "下午" },
  { key: "evening", label: "晚上" },
];

const SORT_FIELD_LABELS: Record<SortField, string> = {
  importance: "按重要程度",
  dueDate: "按截止日期",
  createdAt: "按创建时间",
  title: "按标题",
};

export interface TodoPluginLike {
  todoView?: TodoView;
  taskService: {
    getMyDay(): Task[];
    getInbox(defaultListId: string): Task[];
    getAll(): Task[];
    refreshRecurrenceInstances(): Promise<number>;
    getByListId(listId: string): Task[];
    update(id: string, changes: Partial<Task>): Promise<Task | null>;
    syncRecurrenceSchedule(taskId: string, startDate: string | null, dueDate: string | null): Promise<number>;
    syncRecurrenceProperties(taskId: string, changes: Partial<Task>): Promise<number>;
    create(fields: Partial<Task>): Promise<Task>;
    complete(id: string): Promise<Task | null>;
    uncomplete(id: string): Promise<Task | null>;
    delete(id: string): Promise<boolean>;
    getByPlanKindAndPeriod(kind: PlanKind, periodKey: string): Task[];
    getChildrenOf(parentId: string): Task[];
    countChildren(parentId: string): number;
    getParentOf(taskId: string): Task | undefined;
    getDeleted(): Task[];
    restore(id: string): Promise<boolean>;
    hardDelete(id: string): Promise<boolean>;
    emptyTrash(): Promise<number>;
    getGroupInstances(groupId: string): Task[];
    deleteSeries(groupId: string, taskId?: string): Promise<number>;
    setRecurrence(taskId: string, recurrence: string | null, endDate?: string | null): Promise<void>;
    stopRecurrence(groupId: string, fromTaskId?: string): Promise<number>;
  };
  recurrenceSeriesService?: RecurrenceSeriesService;
  listService: {
    getById(id: string): { id: string; name: string; isDefault: boolean; groupId: string | null; icon: string; tags: string[] } | undefined;
    getActive(): { id: string; name: string; isDefault: boolean; groupId: string | null; icon: string; tags: string[] }[];
    getDefault(): { id: string; name: string } | undefined;
    create(fields: { name: string; icon?: string; tags?: string[] }): Promise<{ id: string; name: string; icon: string; tags: string[] }>;
    rename(id: string, name: string): Promise<{ id: string; name: string } | null>;
    delete(id: string): Promise<boolean>;
    update(id: string, changes: { groupId?: string | null; name?: string; sortOrder?: number; icon?: string; tags?: string[] }): Promise<{ id: string; name: string; groupId: string | null; icon: string; tags: string[] } | null>;
  };
  tagService: {
    getAll(): { id: string; name: string; color: string; icon: string; isDefault: boolean; sortOrder: number }[];
    getById(id: string): { id: string; name: string; color: string; icon: string; sortOrder: number } | undefined;
    getQuadrantTags(): { id: string; name: string; color: string; icon: string; sortOrder: number }[];
    getQuadrantTagForTask(tagIds: string[]): { id: string; name: string; color: string; sortOrder: number } | undefined;
  };
  groupService: {
    getAll(): { id: string; name: string; isCollapsed: boolean; sortOrder: number }[];
    create(fields: { name: string }): Promise<{ id: string; name: string }>;
    rename(id: string, name: string): Promise<{ id: string; name: string } | null>;
    toggleCollapse(id: string): Promise<{ id: string; isCollapsed: boolean } | null>;
    delete(id: string): Promise<boolean>;
    update(id: string, changes: { sortOrder?: number; name?: string; isCollapsed?: boolean }): Promise<{ id: string; name: string } | null>;
  };
  statsService: {
    getDayStats(date: string): ReviewStats;
    getWeekStats(year: number, week: number): ReviewStats;
    getMonthStats(year: number, month: number): ReviewStats;
    getYearStats(year: number): ReviewStats;
    getStatusSummary(start: string, end: string): { total: number; completed: number; active: number; shelved: number; abandoned: number; overdue: number; completionRate: number };
    calcStreak(fromDate: string): number;
    calcMaxStreak(startDate: string, endDate: string): number;
  };
  settings: {
    activeViewNav: ViewNav;
    selectedListId: string | null;
    completedCollapsed: boolean;
    overdueCollapsed: boolean;
    selectedTaskId: string | null;
    sortConfig: SortConfig;
    selectedQuadrant: string | null;
    activePlanKind: PlanKind | null;
    birthday: string;
    planGroupCollapsed: boolean;
    quadrantGroupCollapsed: boolean;
    activeScheduleMode: "day" | "week" | "month";
    activeReviewMode: "day" | "week" | "month" | "year";
    taskFilterStatus: "all" | "active" | "shelved" | "abandoned" | "completed";
    goalViewMode: "card" | "list";
    showLunarCalendar: boolean;
    showDailyRecurringInDaySchedule: boolean;
    showDailyRecurringInWeekSchedule: boolean;
    showDailyRecurringInMonthSchedule: boolean;
    planningIntensity: "light" | "balanced" | "high";
  };
  saveSettings(): Promise<void>;
    app?: App;
  activateNav?: (nav: ViewNav) => Promise<void>;
  activateList?: (listId: string) => Promise<void>;
  activatePlan?: (kind: PlanKind) => Promise<void>;
  showMobilePanel?: (panel: "nav" | "main" | "detail") => void;
}


export class TodoView extends ItemView {
  private plugin: TodoPluginLike;
  private taskListEl!: HTMLDivElement;
  private sortBtnEl!: HTMLButtonElement;
  private sortLabelEl!: HTMLSpanElement;
  private filterBtnEl!: HTMLButtonElement;
  private aiBtnEl!: HTMLButtonElement;
  private headerIconEl!: HTMLSpanElement;
  private headerTitleEl!: HTMLSpanElement;
  private headerSubEl!: HTMLSpanElement;
  private layoutEl!: HTMLDivElement;
  private mobilePanel: "nav" | "main" | "detail" = "main";
  private navEls: Record<ViewNav, HTMLDivElement> = {} as Record<ViewNav, HTMLDivElement>;
  private listNavEl!: HTMLDivElement;
  private listItemsEl!: HTMLDivElement;
  private quickInputEl!: HTMLInputElement;
  private quickContainerEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private mobileDetailRoot: HTMLElement | null = null;
  private mobileDetailLeaf: WorkspaceLeaf | null = null;
  private detailView!: TaskDetailView;
  private aiView!: AIRecommendationView;
  private reviewRenderer!: ReviewRenderer;
  private scheduleRenderer!: ScheduleRenderer;
  private dragController!: ScheduleDragController;
  private planGroupRenderer: PlanGroupRenderer;
  private goalDashboardRenderer: GoalDashboardRenderer;
  private lifePlanRenderer: LifePlanRenderer;
  private planContainerEl!: HTMLDivElement;
  private planGroupEl!: HTMLDivElement;
  private quadrantGroupEl!: HTMLDivElement;
  private activePlanKind: PlanKind | null = null;
  private scheduleMode: "day" | "week" | "month" = "month";
  private scheduleSidebarOpen = false;
  private scheduleYear!: number;
  private scheduleMonth!: number;
  private scheduleDate!: number;
  private reviewMode: ReviewMode = "day";
  private reviewYear!: number;
  private reviewMonth!: number;
  private reviewDate!: number;
  private reviewFilter: { type: "date" | "overdue" | "tag"; value: string; label: string; dateField?: "dueDate" | "completedAt" } | null = null;
  private myDayViewDate: string | null = null;
  private timeLineTimer: number | null = null;
  private dragState: ScheduleDragState | null = null;
  private _onDragMove: ((ev: MouseEvent) => void) | null = null;
  private _onDragEnd: ((ev: MouseEvent) => void) | null = null;
  private _lastDragMoved = false;
  private touchStartX: number | null = null;
  private touchStartY: number | null = null;
  private touchStartedInHorizontalScroll = false;
  private _onTouchStart: ((ev: TouchEvent) => void) | null = null;
  private _onTouchEnd: ((ev: TouchEvent) => void) | null = null;
  private scheduleScrollTarget: "now" | { taskId: string } | "preserve" = "now";

  constructor(leaf: WorkspaceLeaf, plugin: TodoPluginLike) {
    super(leaf);
    this.plugin = plugin;
    this.planGroupRenderer = new PlanGroupRenderer(plugin.taskService, {
      renderTaskRow: (container, task) => this.renderTaskRow(container, task, "plan"),
      isMobile: () => this.isMobile(),
      promptPlanCreate: (kind, periodKey) => this.promptPlanCreate(kind, periodKey),
      onTaskCreated: async () => {
        if (this.activePlanKind === "year" || this.activePlanKind === "month") {
          await this.renderGoalDashboard(this.activePlanKind);
        } else if (this.activePlanKind) {
          await this.renderPlanView(this.activePlanKind);
        }
      },
    });
    this.goalDashboardRenderer = new GoalDashboardRenderer(plugin, this.planGroupRenderer, {
      getTaskListEl: () => this.taskListEl,
      getQuickContainerEl: () => this.quickContainerEl,
      getActivePlanKind: () => this.activePlanKind,
      isMobile: () => this.isMobile(),
      openTask: (taskId) => this.openPlanTask(taskId),
      promptPlanCreate: (kind, periodKey, parentId, tags) =>
        this.promptPlanCreate(kind, periodKey, parentId, tags),
      getWeekPlanMoveOptions: (goal) => this.getPlanMoveOptions(goal),
      refreshLists: () => this.renderLists(),
      confirmQuarterGoal: () => new ConfirmModal(
        this.app,
        "是否为当前月份创建同名月度目标，并关联此季度目标？",
        "创建月度目标",
        false,
      ).openAndConfirm(),
    });
    this.lifePlanRenderer = new LifePlanRenderer({
      getTasks: () => this.plugin.taskService.getAll(),
      getTags: () => this.plugin.tagService.getAll(),
      toggleCompletion: async (task) => {
        if (task.isCompleted) await this.plugin.taskService.uncomplete(task.id);
        else await this.plugin.taskService.complete(task.id);
      },
      openTask: (taskId) => this.openPlanTask(taskId),
    });
    this.reviewRenderer = new ReviewRenderer(plugin, (filter) => this.navigateWithFilter(filter));
    this.scheduleRenderer = new ScheduleRenderer(
      plugin,
      {
        getTaskBlockColor: (task) => this.getTaskBlockColor(task),
        getContrastColor: (color) => this.getContrastColor(color),
        isVisibleInSchedule: (task, view) => this.isVisibleInSchedule(task, view),
        isAllDayTask: (task) => this.isAllDayTask(task),
        openTask: (taskId) => this.openScheduleTask(taskId),
        renderTimedTaskCard: (container, task) => this.renderScheduleTaskCard(container, task),
        startAllDayDrag: (event, task, card, grid, dateStr) => this.startAllDayDrag(event, task, card, grid, dateStr),
        startWeekAllDayDrag: (event, task, card, grid, weekStart, columnIndex) => this.startWeekAllDayDrag(event, task, card, grid, weekStart, columnIndex),
        isDragging: () => this.dragState !== null,
        wasLastDragMoved: () => this._lastDragMoved,
        promptTitle: () => new PromptModal(this.app, "输入任务标题").openAndGetValue(),
        createTask: async (fields) => { await this.plugin.taskService.create(fields); },
        rerender: () => {
          this.scheduleScrollTarget = "preserve";
          this.renderScheduleView();
        },
        renderTimeline: (grid) => this.renderTimeLine(grid),
        snapMinute: (pixels, hourHeight) => this.snapMinute(pixels, hourHeight),
        minuteToIso: (dateStr, minute) => this.minuteToIso(dateStr, minute),
        getScrollTarget: () => this.scheduleScrollTarget,
        consumeScrollTarget: () => { this.scheduleScrollTarget = "preserve"; },
      },
    );
    this.dragController = new ScheduleDragController({
      getState: () => this.dragState,
      setState: (state) => { this.dragState = state; },
      setLastDragMoved: (moved) => { this._lastDragMoved = moved; },
      snapMinute: (pixels, hourHeight) => this.snapMinute(pixels, hourHeight),
      minuteToIso: (dateStr, minute) => this.minuteToIso(dateStr, minute),
      updateTask: async (taskId, changes) => { await this.plugin.taskService.update(taskId, changes); },
      refreshDetail: (taskId) => this.refreshDetailIfActive(taskId),
      openTask: (taskId) => this.openScheduleTask(taskId),
      setScrollTarget: (target) => { this.scheduleScrollTarget = target; },
      rerender: () => this.renderScheduleView(),
    });
  }

  getViewType(): string {
    return VIEW_TYPE_TODO;
  }

  getDisplayText(): string {
    return "Plan to Day";
  }

  getIcon(): string {
    return "check-square";
  }

  async onOpen(): Promise<void> {
    await this.plugin.taskService.refreshRecurrenceInstances();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("plan-to-day-tab");

    const layout = container.createDiv({ cls: "todo-layout" });
    this.layoutEl = layout;
    layout.dataset.mobilePanel = "main";
    this._onTouchStart = (ev: TouchEvent) => {
      if (!this.isMobile() || !ev.touches.length) return;
      this.touchStartX = ev.touches[0].clientX;
      this.touchStartY = ev.touches[0].clientY;
      this.touchStartedInHorizontalScroll = ev.target instanceof Element && !!ev.target.closest(".todo-goal-quarter-scroll");
    };
    this._onTouchEnd = (ev: TouchEvent) => {
      if (!this.isMobile() || this.touchStartX === null || this.touchStartY === null || !ev.changedTouches.length) return;
      const touch = ev.changedTouches[0];
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      const startedInHorizontalScroll = this.touchStartedInHorizontalScroll;
      this.touchStartX = null;
      this.touchStartY = null;
      this.touchStartedInHorizontalScroll = false;
      if (startedInHorizontalScroll) return;
      if (dx > -60 || Math.abs(dx) < Math.abs(dy)) return;
      // The shared detail root can be replaced by task/goal details while the
      // AI view instance still exists. Check the rendered panel as the source
      // of truth so a stale provider state cannot block mobile gestures.
      if (this.detailEl?.hasClass("todo-ai-detail-panel")) return;
       if (this.plugin.settings.activeViewNav === "schedule") {
         this.openScheduleSidebar();
       } else {
         const selectedId = this.plugin.settings.selectedTaskId;
         const selected = selectedId ? this.plugin.taskService.getAll().find((task) => task.id === selectedId) : undefined;
         if (selected) {
           this.detailView.clearHistory();
           this.detailView.open(selected.id);
         } else {
           this.detailView.openEmpty();
         }
       }
       this.layoutEl.addClass("todo-layout-detail-open");
       this.showMobilePanel("detail");
    };
    layout.addEventListener("touchstart", this._onTouchStart, { passive: true });
    layout.addEventListener("touchend", this._onTouchEnd, { passive: true });
    this.plugin.todoView = this;
    const nav = layout.createDiv({ cls: "todo-nav" });
    const main = layout.createDiv({ cls: "todo-main" });
    const taskHeader = main.createDiv({ cls: "todo-task-header" });
    this.headerIconEl = taskHeader.createSpan({ cls: "todo-header-icon" });
    this.headerTitleEl = taskHeader.createSpan({ cls: "todo-header-title" });
    this.headerSubEl = taskHeader.createSpan({ cls: "todo-header-sub" });
    this.sortBtnEl = taskHeader.createEl("button", { cls: "todo-sort-btn" });
    setIcon(this.sortBtnEl, "arrow-up-down");
    this.sortLabelEl = this.sortBtnEl.createSpan({ text: this.getSortLabel(this.plugin.settings.sortConfig.primary.field) });
    this.sortBtnEl.addEventListener("click", (ev) => this.showSortMenu(ev));
    this.filterBtnEl = taskHeader.createEl("button", { cls: "todo-sort-btn todo-filter-btn" });
    setIcon(this.filterBtnEl, "filter");
    this.filterBtnEl.title = t("状态筛选");
    this.filterBtnEl.setAttribute("aria-label", t("状态筛选"));
    this.filterBtnEl.addEventListener("click", (ev) => this.showStatusFilterMenu(ev));
    this.aiBtnEl = taskHeader.createEl("button", { cls: "todo-sort-btn todo-ai-btn" });
    setIcon(this.aiBtnEl, "list-checks");
    this.aiBtnEl.addClass("todo-is-hidden");
    this.aiBtnEl.title = t("待办事项推荐");
    this.aiBtnEl.setAttribute("aria-label", t("待办事项推荐"));
    this.aiBtnEl.addEventListener("click", () => {
      if (this.plugin.settings.activeViewNav !== "myday" || this.plugin.settings.selectedListId) return;
      const layout = this.containerEl.querySelector(".todo-layout");
      if (layout) layout.addClass("todo-layout-detail-open");
      void this.openAIBar();
      this.showMobilePanel("detail");
    });
    this.planContainerEl = main.createDiv({ cls: "todo-plan-container" });

    this.taskListEl = main.createDiv({ cls: "todo-task-list" });
    this.quickContainerEl = main.createDiv({ cls: "todo-quick-add" });

    // Upper section: fixed views
    const upperNav = nav.createDiv({ cls: "todo-nav-section" });
    const upperItems = upperNav.createDiv({ cls: "todo-nav-lists" });
    this.navEls["myday"] = upperItems.createDiv({ cls: "todo-nav-item" });
    setIcon(this.navEls["myday"].createSpan({ cls: "todo-nav-icon" }), "sun");
    this.navEls["myday"].createSpan({ text: "我的一天" });
    this.navEls["all"] = upperItems.createDiv({ cls: "todo-nav-item" });
    setIcon(this.navEls["all"].createSpan({ cls: "todo-nav-icon" }), "list-checks");
    this.navEls["all"].createSpan({ text: "所有任务" });
    this.navEls["inbox"] = upperItems.createDiv({ cls: "todo-nav-item" });
    setIcon(this.navEls["inbox"].createSpan({ cls: "todo-nav-icon" }), "inbox");
    this.navEls["inbox"].createSpan({ text: "任务" });
    this.navEls["schedule"] = upperItems.createDiv({ cls: "todo-nav-item" });
    setIcon(this.navEls["schedule"].createSpan({ cls: "todo-nav-icon" }), "calendar");
    this.navEls["schedule"].createSpan({ text: "我的日程" });

        // Plan mode nav group
    this.planGroupEl = upperItems.createDiv({ cls: "todo-nav-group todo-plan-group" });
    const planHeader = this.planGroupEl.createDiv({ cls: "todo-nav-group-header" });
    const planIcon = planHeader.createSpan();
    setIcon(planIcon, "calendar-days");
    planHeader.createSpan({ cls: "todo-nav-group-name", text: "\u6211\u7684\u8ba1\u5212" });
    const planList = this.planGroupEl.createDiv({ cls: "todo-nav-group-list" });
    planList.toggleClass("todo-is-hidden", this.plugin.settings.planGroupCollapsed);
    const planItems = [
      { name: "人生计划", kind: "life" as PlanKind, icon: "globe" },
      { name: "年度计划", kind: "year" as PlanKind, icon: "calendar-check" },
      { name: "月度计划", kind: "month" as PlanKind, icon: "timer" },
    ];
    for (const pi of planItems) {
      const item = planList.createDiv({ cls: "todo-nav-item todo-plan-item" });
      const piIcon = item.createSpan({ cls: "todo-nav-icon" });
      setIcon(piIcon, pi.icon);
      item.createSpan({ cls: "todo-plan-name", text: pi.name });
      item.addEventListener("click", () => { runAsyncAction((async () => {
        await this.activatePlan(pi.kind);
      })(), "TodoView interaction"); });
    }
    planHeader.addEventListener("click", () => {
      this.plugin.settings.planGroupCollapsed = !this.plugin.settings.planGroupCollapsed;
      planList.toggleClass("todo-is-hidden", this.plugin.settings.planGroupCollapsed);
      void this.plugin.saveSettings();
    });

    // Quadrant mode nav group
    this.quadrantGroupEl = upperItems.createDiv({ cls: "todo-nav-group todo-quadrant-group" });
    const qHeader = this.quadrantGroupEl.createDiv({ cls: "todo-nav-group-header" });
    const qIcon = qHeader.createSpan();
    setIcon(qIcon, "layout-grid");
    qHeader.createSpan({ cls: "todo-nav-group-name", text: "\u56db\u8c61\u9650" });
    const qList = this.quadrantGroupEl.createDiv({ cls: "todo-nav-group-list" });
    qList.toggleClass("todo-is-hidden", this.plugin.settings.quadrantGroupCollapsed);
    const quadrantDefs = [
      { key: "重要紧急", color: "#E74C3C", icon: "alarm-clock" },
      { key: "重要不紧急", color: "#4A90D9", icon: "calendar-check" },
      { key: "不重要紧急", color: "#F5A623", icon: "bell" },
      { key: "不重要不紧急", color: "#95A5A6", icon: "coffee" },
    ];
    for (const qd of quadrantDefs) {
      const qItem = qList.createDiv({ cls: "todo-nav-item todo-quadrant-item" + (this.plugin.settings.selectedQuadrant === qd.key ? " active" : "") });
      const qdIcon = qItem.createSpan({ cls: "todo-nav-icon" });
      setIcon(qdIcon, qd.icon);
      qItem.createSpan({ cls: "todo-quadrant-name", text: qd.key });
      qItem.addEventListener("click", () => { runAsyncAction((async () => {
        this.plugin.settings.selectedQuadrant = qd.key;
        this.plugin.settings.activeViewNav = "all";
        this.plugin.settings.activePlanKind = null;
        this.activePlanKind = null;
        await this.plugin.saveSettings();
        this.plugin.settings.selectedListId = null;
        qList.querySelectorAll(".todo-nav-item").forEach((el) => el.removeClass("active"));
        this.planGroupEl?.querySelectorAll(".todo-plan-item").forEach((el) => el.removeClass("active"));

        Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
        qItem.addClass("active");
        await this.renderTasks("all");
        this.updateHeaderInfo();
        this.showMobilePanel("main");
      })(), "TodoView interaction"); });
    }
    qHeader.addEventListener("click", () => {
      this.plugin.settings.quadrantGroupCollapsed = !this.plugin.settings.quadrantGroupCollapsed;
      qList.toggleClass("todo-is-hidden", this.plugin.settings.quadrantGroupCollapsed);
      void this.plugin.saveSettings();
    });


    Object.entries(this.navEls).forEach(([key, el]) => {
      el.addEventListener("click", () => { runAsyncAction((async () => {
        await this.activateNav(key as ViewNav);
      })(), "TodoView interaction"); });
    });

    this.listNavEl = nav.createDiv({ cls: "todo-nav-section todo-nav-list-section" });
    this.listItemsEl = this.listNavEl.createDiv({ cls: "todo-nav-lists" });

    const addListBtn = this.listNavEl.createDiv({ cls: "todo-nav-add", text: "+ 新建列表" });
    addListBtn.addEventListener("click", () => {
      void this.createListByInput();
    });

    // Settings icon at nav bottom
    const settingsContainer = nav.createDiv({ cls: "todo-nav-settings" });
    const settingsBtn = settingsContainer.createDiv({ cls: "todo-nav-settings-btn" });
    setIcon(settingsBtn, "settings");
        settingsBtn.addEventListener("click", () => {
      if (this.plugin.app) openPluginSettings(this.plugin.app, "plan-to-day");
    });
    // Trash button
    this.navEls["review"] = settingsContainer.createDiv({ cls: "todo-nav-settings-btn" });
    setIcon(this.navEls["review"], "bar-chart-2");
    this.navEls["review"].title = "\u590d\u76d8";
    this.navEls["review"].addEventListener("click", () => { runAsyncAction((async () => { await this.activateNav("review"); })(), "TodoView interaction"); });
    this.navEls["trash"] = settingsContainer.createDiv({ cls: "todo-nav-settings-btn" });
    setIcon(this.navEls["trash"], "trash-2");
    this.navEls["trash"].title = "回收站";
    this.navEls["trash"].addEventListener("click", () => { runAsyncAction((async () => { await this.activateNav("trash"); })(), "TodoView interaction"); });
    const addGroupBtn = settingsContainer.createDiv({ cls: "todo-nav-settings-btn" });
    setIcon(addGroupBtn, "folder-plus");
    addGroupBtn.title = "\u65b0\u5efa\u5206\u7ec4";
    addGroupBtn.addEventListener("click", () => { runAsyncAction((async () => {
      const name = await new PromptModal(this.app, "\u8f93\u5165\u5206\u7ec4\u540d\u79f0").openAndGetValue();
      if (name) {
        await this.plugin.groupService.create({ name });
        await this.renderLists();
      }
    })(), "TodoView interaction"); });

    this.quickInputEl = this.quickContainerEl.createEl("input", { attr: { placeholder: "添加任务..." } });
    this.updateQuickPlaceholder();
    this.quickInputEl.addEventListener("focus", (ev) => {
      if (this.isMobile()) {
        ev.preventDefault();
        this.quickInputEl.blur();
        void this.promptQuickCreate();
      }
    });
    this.quickInputEl.addEventListener("click", (ev) => {
      if (this.isMobile()) {
        ev.preventDefault();
        this.quickInputEl.blur();
        void this.promptQuickCreate();
      }
    });
    this.quickInputEl.addEventListener("keydown", (ev) => { runAsyncAction((async () => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        await this.createTaskFromQuickInput();
      }
    })(), "TodoView interaction"); });

    this.detailEl = layout.createDiv({ cls: "todo-detail" });
    let detailRoot: HTMLElement = this.detailEl;
    if (this.isMobileEnvironment()) {
      const sidebarRoot = await this.openMobileDetailSidebar();
      if (sidebarRoot) detailRoot = sidebarRoot;
    }
    this.detailView = new TaskDetailView(this.app, this.plugin, detailRoot, (taskId) => {
      this.refreshDetailIfActive(taskId);
      if (this.plugin.settings.activeViewNav === "plan" && (this.activePlanKind === "year" || this.activePlanKind === "month")) {
        void this.renderGoalDashboard(this.activePlanKind, true);
      } else if (this.plugin.settings.activeViewNav === "schedule") {
        this.scheduleScrollTarget = { taskId };
        this.renderScheduleView();
      } else {
        const view = this.plugin.settings.selectedListId ? "list" : this.plugin.settings.activeViewNav;
        void this.renderTasks(view);
      }
    }, () => {
      this.scheduleSidebarOpen = false;
      const layout = this.containerEl.querySelector(".todo-layout");
      if (layout) layout.removeClass("todo-layout-detail-open");
      this.showMobilePanel("main");
    }, (targetId) => {
      void this.navigateToTask(targetId);
    }, () => {
      this.showMobilePanel("detail");
    }, (taskId) => {
      void this.navigateFromScheduleSidebar(taskId);
    });
    this.aiView = new AIRecommendationView(this.plugin, detailRoot, () => {
      const layout = this.containerEl.querySelector(".todo-layout");
      if (layout) layout.removeClass("todo-layout-detail-open");
      this.showMobilePanel("main");
    });

    this.plugin.settings.selectedTaskId = null;

    // Restore persisted plan state before navigation normalizes the view.
    this.activePlanKind = this.plugin.settings.activePlanKind || null;
    await this.activateNav(this.plugin.settings.activeViewNav);
    await this.renderLists();

    // T-703: Global drag handlers
    this._onDragMove = (ev: MouseEvent) => this.dragController.handleMove(ev);
    this._onDragEnd = (ev: MouseEvent) => { void this.dragController.handleEnd(ev); };
    document.addEventListener("mousemove", this._onDragMove);
    document.addEventListener("mouseup", this._onDragEnd);
    localizeDom(this.containerEl);
  }

  private async openAIBar(): Promise<void> {
    if (this.plugin.settings.activeViewNav !== "myday" || this.plugin.settings.selectedListId) return;
    const date = this.myDayViewDate || localTodayStr();
    const provider = new LocalAIProvider();
    const accept = async (item: AIRecommendation): Promise<void> => {
      const error = validateRecommendation(item);
      if (error) { new Notice(error); return; }
      const itemDate = item.startDate ? extractLocalDate(item.startDate) : item.dueDate ? extractLocalDate(item.dueDate) : null;
      const currentTasks = this.plugin.taskService.getAll();
      const weeklyGoalId = item.parentId &&
        currentTasks.some((task) => task.id === item.parentId && task.planKind === "week")
        ? item.parentId
        : undefined;
      const duplicate = currentTasks.some((task) =>
        task.id !== weeklyGoalId &&
        !task.isDeleted &&
        isSimilar(task.title, item.title) &&
        this.getTaskMyDayDate(task) === itemDate,
      );
      if (duplicate) { new Notice(t("跳过重复或无效项")); return; }
      if (item.sourceTaskId) await this.plugin.taskService.update(item.sourceTaskId, { myDayGroup: item.myDayGroup, startDate: item.startDate, dueDate: item.dueDate });
      else await this.plugin.taskService.create({ title: item.title, note: item.note, listId: item.listId, tags: item.tags, isImportant: item.isImportant, myDayGroup: item.myDayGroup ?? "allday", startDate: item.startDate ?? null, dueDate: item.dueDate ?? null, parentId: item.parentId });
      // Refresh the main task area without calling refreshAll(), which closes
      // the active detail/AI sidebar as part of its reset flow.
      await this.refreshAfterAIAccept();
      new Notice(t("已保存"));
    };
    const generate = async (): Promise<AIRecommendation[]> => {
      return provider.recommendMyDay({ tasks: this.plugin.taskService.getAll(), date, intensity: this.plugin.settings.planningIntensity });
    };
    this.aiView.open([], generate, accept);
    try {
      const items = await generate();
      if (this.aiView.isOpen() && this.plugin.settings.activeViewNav === "myday" && !this.plugin.settings.selectedListId) {
        this.aiView.open(items, generate, accept);
      }
    } catch (error) {
      console.error(error);
      new Notice(t("推荐生成失败，请稍后重试"));
    }
  }

  async onClose(): Promise<void> {
    if (this.timeLineTimer) { window.clearInterval(this.timeLineTimer); this.timeLineTimer = null; }
    if (this._onDragMove) document.removeEventListener("mousemove", this._onDragMove);
    if (this._onDragEnd) document.removeEventListener("mouseup", this._onDragEnd);
    this.goalDashboardRenderer.dispose();
    if (this._onTouchStart) this.layoutEl?.removeEventListener("touchstart", this._onTouchStart);
    if (this._onTouchEnd) this.layoutEl?.removeEventListener("touchend", this._onTouchEnd);
    this.containerEl.empty();
  }

  /** 外部调用：刷新整个视图（设置页清空/重置后使用） */
  async refreshAll(): Promise<void> {
    try {
      this.closeDetail();
      this.plugin.settings.selectedListId = null;
      this.plugin.settings.selectedTaskId = null;
      const nav = this.plugin.settings.activeViewNav;
      if (nav === "schedule") {
        this.taskListEl.empty();
        this.renderScheduleView();
        await this.renderLists();
      } else if (nav === "trash") {
        this.taskListEl.empty();
        this.renderTrashView();
        await this.renderLists();
      } else {
        await this.activateNav(nav);
      }
      localizeDom(this.containerEl);
    } catch (e) {
      console.error("refreshAll failed, falling back to empty state:", e);
      this.taskListEl.empty();
      this.taskListEl.createDiv({ cls: "todo-empty-state", text: "\u89c6\u56fe\u5df2\u91cd\u7f6e\uff0c\u8bf7\u91cd\u65b0\u5bfc\u822a" });
    }

  }

  private async navigateWithFilter(filter: { type: "date" | "overdue" | "tag"; value: string; label: string; dateField?: "dueDate" | "completedAt" }): Promise<void> {
    this.reviewFilter = filter;
    await this.activateNav("all");
  }

  
  private isMobileEnvironment(): boolean {
    return window.innerWidth <= 600 || document.body.hasClass("is-mobile");
  }

  private async refreshAfterAIAccept(): Promise<void> {
    const nav = this.plugin.settings.activeViewNav;
    await this.renderLists();
    if (nav === "plan" && this.activePlanKind) {
      if (this.activePlanKind === "life") await this.renderLifePlanView();
      else if (this.activePlanKind === "year" || this.activePlanKind === "month") await this.renderGoalDashboard(this.activePlanKind);
      else await this.renderPlanView(this.activePlanKind);
    } else if (nav === "schedule") {
      this.taskListEl.empty();
      this.renderScheduleView();
    } else if (nav === "trash") {
      this.taskListEl.empty();
      this.renderTrashView();
    } else {
      await this.renderTasks(this.plugin.settings.selectedListId ? "list" : nav);
    }
    localizeDom(this.containerEl);
  }

  private isMobile(): boolean {
    return this.isMobileEnvironment() || (!!this.layoutEl && this.layoutEl.clientWidth <= 600);
  }

  private async openMobileDetailSidebar(): Promise<HTMLElement | null> {
    if (!this.isMobileEnvironment()) return this.detailEl;
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_DETAIL)[0];
    if (!leaf) leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE_TODO_DETAIL, "right", { active: false, reveal: false });
    if (!leaf) return null;
    await leaf.setViewState({ type: VIEW_TYPE_TODO_DETAIL, active: false });
    this.mobileDetailLeaf = leaf;
    const view = leaf.view;
    if (!(view instanceof TodoDetailSidebarView)) return null;
    view.contentEl.addClass("todo-detail-sidebar-host");
    this.mobileDetailRoot = view.contentEl;
    return view.contentEl;
  }

  private revealMobileDetailSidebar(): void {
    if (!this.isMobileEnvironment() || !this.mobileDetailLeaf) return;
    this.app.workspace.rightSplit.expand();
    runAsyncAction(this.app.workspace.revealLeaf(this.mobileDetailLeaf), "reveal task details");
  }

  private collapseMobileDetailSidebar(): void {
    if (!this.isMobileEnvironment()) return;
    this.app.workspace.rightSplit.collapse();
  }

  attachMobileDetailRoot(root: HTMLElement): void {
    this.mobileDetailRoot = root;
    this.detailView?.setRoot(root);
    this.aiView?.setRoot(root);
  }

  detachMobileDetailRoot(root: HTMLElement): void {
    if (this.mobileDetailRoot === root) this.mobileDetailRoot = null;
  }

  private showMobilePanel(panel: "nav" | "main" | "detail"): void {
    if (!this.layoutEl) return;
    this.mobilePanel = panel;
    this.layoutEl.dataset.mobilePanel = panel;
    if (panel !== "detail") this.scheduleSidebarOpen = false;
    if (panel === "detail") this.revealMobileDetailSidebar();
    else this.collapseMobileDetailSidebar();
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const listId = this.plugin.settings.selectedListId;
    if (!listId) return;
    const list = this.plugin.listService.getById(listId);
    if (!list || list.isDefault) return;
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("编辑列表").setIcon("pencil").onClick(async () => {
      const modal = new CreateListModal(this.app, { name: list.name, icon: list.icon || "list", tags: (this.plugin.listService.getById(listId)?.tags || []) }, this.plugin.tagService.getAll());
      const result = await modal.openAndGetValue();
      if (result) {
        await this.plugin.listService.update(listId, { name: result.name, icon: result.icon, tags: result.tags });
        await this.syncListTags(listId, result.tags);
        this.updateHeaderInfo();
        await this.renderLists();
      }
    }));
    menu.addItem((item) => item.setTitle("删除列表").setIcon("trash").onClick(async () => {
      const confirmed = await new ConfirmModal(this.app, "确定删除「" + list.name + "」吗？列表中的任务也会被删除。").openAndConfirm();
      if (confirmed) {
        await this.plugin.listService.delete(listId);
        this.plugin.settings.selectedListId = null;
        await this.plugin.saveSettings();
        await this.activateNav("myday");
      }
    }));
  }

  private updateHeaderInfo(): void {
    if (!this.headerIconEl || !this.headerTitleEl) return;
    
    const { activeViewNav, selectedListId, selectedQuadrant } = this.plugin.settings;
    
    // Plan icon mapping
    const planIcons: Record<PlanKind, string> = {
      life: "globe",
      year: "calendar-check",
      quarter: "calendar",
      month: "timer",
      week: "calendar-days",
    };
    const planNames: Record<PlanKind, string> = {
      life: "人生计划",
      year: "年度计划",
      quarter: "季度计划",
      month: "月度计划",
      week: "周计划",
    };
    
    // Quadrant icon mapping
    const quadrantIcons: Record<string, string> = {
      "重要紧急": "alarm-clock",
      "重要不紧急": "calendar-check",
      "不重要紧急": "bell",
      "不重要不紧急": "coffee",
    };
    
    let icon = "list-checks";
    let title = "所有任务";
    let isEditable = false;
    let listId: string | null = null;
    
    if (selectedListId) {
      const list = this.plugin.listService.getById(selectedListId);
      if (list) {
        icon = list.icon || "list";
        title = list.name;
        isEditable = true;
        listId = selectedListId;
      }
    } else if (selectedQuadrant && activeViewNav === "all") {
      icon = quadrantIcons[selectedQuadrant] || "layout-grid";
      title = selectedQuadrant;
      isEditable = false;
    } else if (activeViewNav === "plan" && this.activePlanKind) {
      icon = planIcons[this.activePlanKind] || "calendar-days";
      title = planNames[this.activePlanKind] || "我的计划";
      isEditable = false;
    } else {
      switch (activeViewNav) {
        case "myday":
          icon = "sun";
          if (this.myDayViewDate) {
            const parts = this.myDayViewDate.split("-");
            title = "我的一天 · " + (+parts[1]) + "月" + (+parts[2]) + "日";
          } else {
            title = "我的一天";
          }
          break;
        case "all":
          icon = "list-checks";
          title = "所有任务";
          break;
        case "inbox":
          icon = "inbox";
          title = "任务";
          break;
        case "schedule":
          icon = "calendar";
          title = "我的日程";
          break;
        case "plan":
          icon = "calendar-days";
          title = "我的计划";
          break;
        case "review":
          icon = "bar-chart-2";
          title = "统计";
          break;
        case "trash":
          icon = "trash-2";
          title = "回收站";
          break;
        default:
          icon = "list-checks";
          title = "所有任务";
      }
    }
    
    // Update icon
    this.headerIconEl.empty();
    setIcon(this.headerIconEl, icon);
    this.headerIconEl.onclick = null;
    this.headerIconEl.toggleClass("editable", isEditable);
    if (isEditable && listId) {
      this.headerIconEl.onclick = () => {
        new IconPickerModal(this.app, icon, (iconName) => { runAsyncAction((async () => {
          await this.plugin.listService.update(listId, { icon: iconName });
          this.updateHeaderInfo();
          await this.renderLists();
        })(), "TodoView interaction"); }).open();
      };
    }
    
    // Update title
    this.headerTitleEl.textContent = title;
    this.headerTitleEl.toggleClass("editable", isEditable);
    this.headerTitleEl.onclick = null;
    if (isEditable) {
      this.headerTitleEl.onclick = () => {
        const selection = window.getSelection();
        if (selection) {
          selection.selectAllChildren(this.headerTitleEl);
        }
      };
    }


    // Show task suggestions only in My Day, sort/filter buttons in task views.
    if (this.aiBtnEl && this.sortBtnEl && this.filterBtnEl) {
      const isMyday = activeViewNav === "myday" && !selectedListId;
      const isTaskView = activeViewNav === "all" || activeViewNav === "inbox" || !!selectedListId;
      this.aiBtnEl.toggleClass("todo-is-hidden", !isMyday);
      this.aiBtnEl.title = t("待办事项推荐");
      this.aiBtnEl.setAttribute("aria-label", t("待办事项推荐"));
      this.filterBtnEl.toggleClass("todo-is-hidden", !isTaskView);
      this.filterBtnEl.style.marginLeft = isMyday ? "auto" : "4px";
      this.filterBtnEl.title = t("状态筛选");
      this.filterBtnEl.setAttribute("aria-label", t("状态筛选"));
      if (isMyday) this.sortBtnEl.addClass("todo-is-hidden");
    }

    // Update subtitle
    if (this.headerSubEl) {
      this.headerSubEl.textContent = "";
      this.headerSubEl.addClass("todo-is-hidden");
    }
    localizeDom(this.containerEl);
  }

  async activateNavFromExternal(nav: ViewNav): Promise<void> {
    await this.activateNav(nav);
  }

  async activateListFromExternal(listId: string): Promise<void> {
    await this.activateList(listId);
  }

  async activatePlanFromExternal(kind: PlanKind): Promise<void> {
    await this.activatePlan(kind);
  }

  showMobilePanelFromExternal(panel: "nav" | "main" | "detail"): void {
    this.showMobilePanel(panel);
  }

private async activateNav(nav: ViewNav): Promise<void> {
    this.closeDetail();
    this.taskListEl.removeClass("todo-life-active");
    if (nav !== "all") this.reviewFilter = null;
    this.myDayViewDate = null;
    this.plugin.settings.activeViewNav = nav;
    this.plugin.settings.selectedListId = null;
    if (nav !== "plan") {
      this.activePlanKind = null;
      this.plugin.settings.activePlanKind = null;
    }
    if (nav === "review") {
      this.plugin.settings.selectedQuadrant = null;
      this.sortBtnEl.addClass("todo-is-hidden");
      this.quickContainerEl.addClass("todo-is-hidden");
      this.reviewMode = this.plugin.settings.activeReviewMode || "day";
      const now = new Date();
      this.reviewYear = now.getFullYear();
      this.reviewMonth = now.getMonth();
      this.reviewDate = now.getDate();
      await this.plugin.saveSettings();
      await this.renderLists();
      Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
      this.navEls["review"].addClass("active");
      this.taskListEl.removeClass("todo-trash-active");
      this.taskListEl.removeClass("todo-schedule-active");
      this.taskListEl.addClass("todo-review-active");
      this.taskListEl.empty();
      this.renderReviewView();
      this.updateHeaderInfo();
      this.showMobilePanel("main");
      return;
    }
    if (nav === "schedule") {
      this.plugin.settings.selectedQuadrant = null;
      this.sortBtnEl.addClass("todo-is-hidden");
      this.quickContainerEl.addClass("todo-is-hidden");
      this.scheduleMode = this.plugin.settings.activeScheduleMode || "month";
      const now = new Date();
      this.scheduleYear = now.getFullYear();
      this.scheduleMonth = now.getMonth();
      this.scheduleDate = now.getDate();
      await this.plugin.saveSettings();
      await this.renderLists();
      Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
      this.navEls["schedule"].addClass("active");
      this.taskListEl.removeClass("todo-trash-active");
      this.taskListEl.addClass("todo-schedule-active");
      this.taskListEl.empty();
      this.scheduleScrollTarget = "now";
      this.renderScheduleView();
      this.updateHeaderInfo();
      this.showMobilePanel("main");
      return;
    }
    if (nav === "trash") {
      this.plugin.settings.selectedQuadrant = null;
      this.sortBtnEl.addClass("todo-is-hidden");
      this.quickContainerEl.addClass("todo-is-hidden");
      Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
      this.taskListEl.addClass("todo-trash-active");
      this.taskListEl.removeClass("todo-schedule-active");
      this.taskListEl.empty();
      this.renderTrashView();
      this.updateHeaderInfo();
      this.showMobilePanel("main");
      return;
    }
    if (nav === "plan" && this.activePlanKind) {
      this.plugin.settings.selectedQuadrant = null;
      this.sortBtnEl.addClass("todo-is-hidden");
      this.updateQuickPlaceholder();
      await this.plugin.saveSettings();
      await this.renderLists();
      Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
      this.taskListEl.empty();
      if (this.activePlanKind === 'life') {
        await this.renderLifePlanView();
      } else if (this.activePlanKind === 'year' || this.activePlanKind === 'month') {
        await this.renderGoalDashboard(this.activePlanKind);
      } else {
        await this.renderPlanView(this.activePlanKind);
      }
      this.updateHeaderInfo();
      return;
    }
    this.activePlanKind = null;
    this.plugin.settings.activePlanKind = null;
    this.plugin.settings.selectedQuadrant = null;
    this.sortBtnEl.toggleClass("todo-is-hidden", nav === "myday");
    this.quickContainerEl.removeClass("todo-is-hidden");
    this.taskListEl.removeClass("todo-schedule-active");
    this.taskListEl.removeClass("todo-trash-active");
    this.taskListEl.removeClass("todo-review-active");
    await this.plugin.saveSettings();

    if (this.planContainerEl) {
      this.planContainerEl.addClass("todo-plan-visible");
    }

    await this.renderLists();

    Object.entries(this.navEls).forEach(([key, el]) => {
      el.toggleClass("active", key === nav);
    });
    this.listItemsEl?.querySelectorAll<HTMLDivElement>(".todo-nav-item").forEach((el) => el.removeClass("active"));
    this.quadrantGroupEl?.querySelectorAll<HTMLDivElement>(".todo-quadrant-item").forEach((el) => el.removeClass("active"));
    this.planGroupEl?.querySelectorAll<HTMLDivElement>(".todo-plan-item").forEach((el) => el.removeClass("active"));

    await this.renderTasks(nav);
    this.updateQuickPlaceholder();
    this.updateHeaderInfo();
    this.showMobilePanel("main");
  }

  private async activateList(listId: string): Promise<void> {
    this.closeDetail();
    // A regular list is outside plan mode. Clear both runtime and persisted
    // state so quick-create creates a normal task in the selected list.
    this.plugin.settings.activeViewNav = "all";
    this.plugin.settings.selectedListId = listId;
    this.plugin.settings.selectedQuadrant = null;
    this.plugin.settings.activePlanKind = null;
    this.activePlanKind = null;
    await this.plugin.saveSettings();

    Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
    this.listItemsEl?.querySelectorAll<HTMLDivElement>(".todo-nav-item").forEach((el) => {
      el.toggleClass("active", el.dataset.listId === listId);
    });

    await this.renderTasks("list");
    this.updateQuickPlaceholder();
    this.updateHeaderInfo();
    this.showMobilePanel("main");
  }

  private async renderLists(): Promise<void> {
    if (!this.listItemsEl) return;
    this.listItemsEl.empty();

    const lists = this.plugin.listService.getActive().filter((l) => !l.isDefault);
    const groups = this.plugin.groupService.getAll();

    if (!lists.length && !groups.length) {
      this.listItemsEl.createDiv({ cls: "todo-empty-state", text: t("\u8fd8\u6ca1\u6709\u5217\u8868") });
      return;
    }

    const grouped = new Map<string, typeof lists>();
    const ungrouped: typeof lists = [];
    for (const list of lists) {
      if (list.groupId) {
        const arr = grouped.get(list.groupId) || [];
        arr.push(list);
        grouped.set(list.groupId, arr);
      } else {
        ungrouped.push(list);
      }
    }

    // Ungrouped drop zone (before groups)
    this.setupDropZone(this.listItemsEl, null);

    for (const group of groups) {
      const groupLists = grouped.get(group.id) || [];
      const groupEl = this.listItemsEl.createDiv({ cls: "todo-nav-group" });
      const headerEl = groupEl.createDiv({ cls: "todo-nav-group-header" });
      headerEl.draggable = true;
      headerEl.dataset.groupId = group.id;
      const arrow = headerEl.createSpan({ cls: "todo-nav-group-arrow" + (group.isCollapsed ? " collapsed" : ""), text: "\u25bc" });
      headerEl.createSpan({ cls: "todo-nav-group-name", text: group.name });
      headerEl.createSpan({ cls: "todo-nav-group-count", text: String(groupLists.length) });

      // Group drag events
      headerEl.addEventListener("dragstart", (ev) => {
        ev.dataTransfer!.setData("text/plain", JSON.stringify({ type: "group", id: group.id }));
        ev.dataTransfer!.effectAllowed = "move";
        headerEl.addClass("dragging");
      });
      headerEl.addEventListener("dragend", () => {
        headerEl.removeClass("dragging");
        this.clearAllDragStyles();
      });
      this.setupGroupDropTarget(headerEl, group.id);

      headerEl.addEventListener("click", () => { runAsyncAction((async () => {
        await this.plugin.groupService.toggleCollapse(group.id);
        arrow.toggleClass("collapsed", !group.isCollapsed);
        const listEl = groupEl.querySelector(".todo-nav-group-list") as HTMLElement;
        if (listEl) listEl.toggleClass("todo-is-hidden", !group.isCollapsed);
        await this.renderLists();
      })(), "TodoView interaction"); });

      headerEl.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.showGroupContextMenu(ev, group.id, group.name);
      });

      const listEl = groupEl.createDiv({ cls: "todo-nav-group-list" });
      listEl.toggleClass("todo-is-hidden", group.isCollapsed);
      for (const list of groupLists) {
        this.renderListItem(listEl, list);
      }
      this.setupDropZone(listEl, group.id);
    }

    for (const list of ungrouped) {
      this.renderListItem(this.listItemsEl, list);
    }
  }

  private renderListItem(container: HTMLElement, list: { id: string; name: string; isDefault: boolean; icon?: string }): void {
    const row = container.createDiv({ cls: "todo-nav-item todo-list-item" + (this.plugin.settings.selectedListId === list.id ? " active" : "") });
    row.dataset.listId = list.id;
    row.draggable = true;
    const listIcon = row.createSpan({ cls: "todo-list-icon" });
    setIcon(listIcon, list.icon || "list");
    row.createSpan({ cls: "todo-list-name", text: list.name });

    const actions = row.createDiv({ cls: "todo-list-actions" });
    const renameBtn = actions.createSpan({ cls: "todo-list-action", text: "\u91cd\u547d\u540d" });
    const deleteBtn = actions.createSpan({ cls: "todo-list-action todo-list-action-danger", text: "\u5220\u9664" });

    // Drag events
    row.addEventListener("dragstart", (ev) => {
      ev.dataTransfer!.setData("text/plain", JSON.stringify({ type: "list", id: list.id }));
      ev.dataTransfer!.effectAllowed = "move";
      row.addClass("dragging");
    });
    row.addEventListener("dragend", () => {
      row.removeClass("dragging");
      this.clearAllDragStyles();
    });
    this.setupListItemDropTarget(row, list.id);

    row.addEventListener("click", () => { runAsyncAction((async () => {
      await this.activateList(list.id);
    })(), "TodoView interaction"); });

    renameBtn.addEventListener("click", (ev) => { runAsyncAction((async () => {
      ev.stopPropagation();
      const modal = new CreateListModal(this.app, { name: list.name, icon: list.icon || "list", tags: (this.plugin.listService.getById(list.id)?.tags || []) }, this.plugin.tagService.getAll());
      const result = await modal.openAndGetValue();
      if (!result?.name.trim()) return;
      await this.plugin.listService.update(list.id, { name: result.name.trim(), icon: result.icon, tags: result.tags });
      await this.syncListTags(list.id, result.tags);
      await this.renderLists();
      if (this.plugin.settings.selectedListId === list.id) this.updateHeaderInfo();
    })(), "TodoView interaction"); });

    deleteBtn.addEventListener("click", (ev) => { runAsyncAction((async () => {
      ev.stopPropagation();
      if (list.isDefault) {
        new Notice("\u9ed8\u8ba4\u5217\u8868\u4e0d\u53ef\u5220\u9664");
        return;
      }
      const confirmed = await new ConfirmModal(this.app, "\u786e\u8ba4\u5220\u9664\u5217\u8868\u300c" + list.name + "\u300d\uff1f").openAndConfirm();
      if (!confirmed) return;
            // Reassign orphaned tasks to default list before deletion
      const defaultList = this.plugin.listService.getDefault();
      if (defaultList) {
        const orphanTasks = this.plugin.taskService.getByListId(list.id);
        for (const t of orphanTasks) {
          await this.plugin.taskService.update(t.id, { listId: defaultList.id });
        }
      }
      await this.plugin.listService.delete(list.id);
      if (this.plugin.settings.selectedListId === list.id) {
        this.plugin.settings.selectedQuadrant = null;
      await this.activateNav("myday");
      }
      await this.renderLists();
    })(), "TodoView interaction"); });

      }

  private setupDropZone(el: HTMLElement, targetGroupId: string | null): void {
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = "move";
    });
    el.addEventListener("drop", (ev) => { runAsyncAction((async () => {
      ev.preventDefault();
      this.clearAllDragStyles();
      try {
        const data = parseNavDragPayload(ev.dataTransfer?.getData("text/plain") ?? "");
        if (!data) return;
        if (data.type === "list") {
          const allLists = this.plugin.listService.getActive();
          const dragged = allLists.find((l) => l.id === data.id);
          if (!dragged) return;
          // Update groupId if changed
          if ((dragged.groupId || null) !== targetGroupId) {
            await this.plugin.listService.update(data.id, { groupId: targetGroupId });
          }
          // Reorder: put at end of target group
          const targetLists = allLists.filter((l) => (l.groupId || null) === targetGroupId && l.id !== data.id);
          for (let i = 0; i < targetLists.length; i++) {
            await this.plugin.listService.update(targetLists[i].id, { sortOrder: i });
          }
          await this.plugin.listService.update(data.id, { sortOrder: targetLists.length });
          await this.renderLists();
        }
      } catch (error) { reportAsyncError("move list to group", error); }
    })(), "TodoView interaction"); });
  }

  private setupListItemDropTarget(row: HTMLElement, listId: string): void {
    row.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer!.dropEffect = "move";
      row.addClass("drag-over");
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("drag-over");
    });
    row.addEventListener("drop", (ev) => { runAsyncAction((async () => {
      ev.preventDefault();
      ev.stopPropagation();
      row.removeClass("drag-over");
      this.clearAllDragStyles();
      try {
        const data = parseNavDragPayload(ev.dataTransfer?.getData("text/plain") ?? "");
        if (!data) return;
        if (data.type === "list" && data.id !== listId) {
          const allLists = this.plugin.listService.getActive();
          const dragged = allLists.find((l) => l.id === data.id);
          const target = allLists.find((l) => l.id === listId);
          if (!dragged || !target) return;
          // Move dragged to same group as target
          if ((dragged.groupId || null) !== (target.groupId || null)) {
            await this.plugin.listService.update(data.id, { groupId: target.groupId || null });
          }
          // Reorder: insert before target
          const groupLists = allLists.filter((l) => (l.groupId || null) === (target.groupId || null) && l.id !== data.id);
          const targetIdx = groupLists.findIndex((l) => l.id === listId);
          groupLists.splice(targetIdx, 0, dragged);
          for (let i = 0; i < groupLists.length; i++) {
            await this.plugin.listService.update(groupLists[i].id, { sortOrder: i });
          }
          await this.renderLists();
        }
      } catch (error) { reportAsyncError("reorder list", error); }
    })(), "TodoView interaction"); });
  }

  private setupGroupDropTarget(headerEl: HTMLElement, groupId: string): void {
    headerEl.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer!.dropEffect = "move";
      headerEl.addClass("drag-over");
    });
    headerEl.addEventListener("dragleave", () => {
      headerEl.removeClass("drag-over");
    });
    headerEl.addEventListener("drop", (ev) => { runAsyncAction((async () => {
      ev.preventDefault();
      ev.stopPropagation();
      headerEl.removeClass("drag-over");
      this.clearAllDragStyles();
      try {
        const data = parseNavDragPayload(ev.dataTransfer?.getData("text/plain") ?? "");
        if (!data) return;
        if (data.type === "group" && data.id !== groupId) {
          const allGroups = this.plugin.groupService.getAll();
          const dragged = allGroups.find((g) => g.id === data.id);
          const target = allGroups.find((g) => g.id === groupId);
          if (!dragged || !target) return;
          const targetIdx = allGroups.findIndex((g) => g.id === groupId);
          const filtered = allGroups.filter((g) => g.id !== data.id);
          filtered.splice(targetIdx, 0, dragged);
          for (let i = 0; i < filtered.length; i++) {
            await this.plugin.groupService.update(filtered[i].id, { sortOrder: i });
          }
          await this.renderLists();
        }
        if (data.type === "list") {
          // List dropped on group header - move list into this group
          const allLists = this.plugin.listService.getActive();
          const dragged = allLists.find((l) => l.id === data.id);
          if (!dragged) return;
          if ((dragged.groupId || null) !== groupId) {
            await this.plugin.listService.update(data.id, { groupId });
          }
          const groupLists = allLists.filter((l) => (l.groupId || null) === groupId && l.id !== data.id);
          for (let i = 0; i < groupLists.length; i++) {
            await this.plugin.listService.update(groupLists[i].id, { sortOrder: i });
          }
          await this.plugin.listService.update(data.id, { sortOrder: groupLists.length });
          await this.renderLists();
        }
      } catch (error) { reportAsyncError("reorder group", error); }
    })(), "TodoView interaction"); });
  }

  private clearAllDragStyles(): void {
    this.listItemsEl?.querySelectorAll(".drag-over").forEach((el) => el.removeClass("drag-over"));
    this.listItemsEl?.querySelectorAll(".dragging").forEach((el) => el.removeClass("dragging"));
  }

  
  private showGroupContextMenu(ev: MouseEvent, groupId: string, groupName: string): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("\u91cd\u547d\u540d\u5206\u7ec4").setIcon("pencil").onClick(async () => {
      const name = await new PromptModal(this.app, "\u8f93\u5165\u65b0\u540d\u79f0").openAndGetValue();
      if (name) {
        await this.plugin.groupService.rename(groupId, name);
        await this.renderLists();
      }
    }));
    menu.addItem((item) => item.setTitle("\u5220\u9664\u5206\u7ec4").setIcon("trash").onClick(async () => {
      const confirmed = await new ConfirmModal(this.app, "\u786e\u8ba4\u5220\u9664\u5206\u7ec4\u300c" + groupName + "\u300d\uff1f\u5206\u7ec4\u5185\u5217\u8868\u5c06\u53d8\u4e3a\u672a\u5206\u7ec4\u3002").openAndConfirm();
      if (confirmed) {
        const groupLists = this.plugin.listService.getActive().filter((l) => l.groupId === groupId);
        for (const l of groupLists) {
          await this.plugin.listService.update(l.id, { groupId: null });
        }
        await this.plugin.groupService.delete(groupId);
        await this.renderLists();
      }
    }));
    menu.showAtMouseEvent(ev);
  }

  private showListContextMenu(ev: MouseEvent, listId: string, listName: string): void {
    const menu = new Menu();
    const groups = this.plugin.groupService.getAll();
    if (groups.length > 0) {
      menu.addItem((item) => item.setTitle("\u79fb\u52a8\u5230\u5206\u7ec4").setIcon("folder").onClick(() => {
        const subMenu = new Menu();
        subMenu.addItem((s) => s.setTitle("\u65e0\u5206\u7ec4").onClick(async () => {
          await this.plugin.listService.update(listId, { groupId: null });
          await this.renderLists();
        }));
        for (const g of groups) {
          subMenu.addItem((s) => s.setTitle(g.name).onClick(async () => {
            await this.plugin.listService.update(listId, { groupId: g.id });
            await this.renderLists();
          }));
        }
        subMenu.showAtMouseEvent(ev);
      }));
    }
    const list = this.plugin.listService.getById(listId);
    const currentIcon = list?.icon || "list";
    menu.addItem((item) => item.setTitle("更改图标").setIcon("image").onClick(() => {
      new IconPickerModal(this.app, currentIcon, (iconName) => { runAsyncAction((async () => {
        await this.plugin.listService.update(listId, { icon: iconName });
        await this.renderLists();
      })(), "TodoView interaction"); }).open();
    }));
    menu.addItem((item) => item.setTitle("\u91cd\u547d\u540d").setIcon("pencil").onClick(async () => {
      const row = this.listItemsEl.querySelector('[data-list-id="' + listId + '"]') as HTMLDivElement;
      if (row) await this.renameListInline(listId, listName, row);
    }));
    menu.addItem((item) => item.setTitle("\u5220\u9664").setIcon("trash").onClick(async () => {
      const confirmed = await new ConfirmModal(this.app, "\u786e\u8ba4\u5220\u9664\u5217\u8868\u300c" + listName + "\u300d\uff1f").openAndConfirm();
      if (confirmed) {
        await this.plugin.listService.delete(listId);
        await this.renderLists();
      }
    }));
    menu.showAtMouseEvent(ev);
  }


  private getSortLabel(field: SortField): string {
    return t(SORT_FIELD_LABELS[field] ?? field);
  }


  private showSortMenu(ev: MouseEvent): void {
    const fields = Object.entries(SORT_FIELD_LABELS) as [SortField, string][];
    const menu = new Menu();
    const currentField = this.plugin.settings.sortConfig.primary.field;
    fields.forEach(([field, label]) => {
      menu.addItem((item) =>
        item.setTitle(t(label)).setChecked(field === currentField).onClick(async () => {
          const defaultDir: Record<SortField, SortDirection> = {
            importance: "desc", dueDate: "asc", createdAt: "desc", title: "asc",
          };
          this.plugin.settings.sortConfig = {
            primary: { field, direction: defaultDir[field] },
            secondary: { field: "createdAt", direction: "desc" },
          };
          await this.plugin.saveSettings();
          this.sortLabelEl.textContent = this.getSortLabel(field);
          const currentView = this.plugin.settings.selectedListId ? "list" : this.plugin.settings.activeViewNav;
          await this.renderTasks(currentView);
        })
      );
    });
    menu.showAtMouseEvent(ev);
  }

  private showStatusFilterMenu(ev: MouseEvent): void {
    const options: Array<[TodoPluginLike["settings"]["taskFilterStatus"], string, string]> = [
      ["active", "进行中", "circle-dot"],
      ["all", "全部", "list"],
      ["completed", "已完成", "check-circle-2"],
      ["shelved", "已搁置", "pause-circle"],
      ["abandoned", "已放弃", "x-circle"],
    ];
    const menu = new Menu();
    for (const [status, label, icon] of options) {
      menu.addItem((item) => item
        .setTitle(t(label))
        .setIcon(icon)
        .setChecked(this.plugin.settings.taskFilterStatus === status)
        .onClick(async () => {
          this.plugin.settings.taskFilterStatus = status;
          await this.plugin.saveSettings();
          const view = this.plugin.settings.selectedListId ? "list" : this.plugin.settings.activeViewNav;
          await this.renderTasks(view);
        }));
    }
    menu.showAtMouseEvent(ev);
  }

  private getTaskMyDayDate(task: Task): string | null {
    return task.dueDate ? extractLocalDate(task.dueDate) : task.startDate ? extractLocalDate(task.startDate) : null;
  }

  private isScheduledWeekPlan(task: Task): boolean {
    return task.planKind === "week" && !!(task.startDate || task.dueDate);
  }

  private async renderTasks(view: ViewNav | "list"): Promise<void> {
    if (view === "plan" && this.activePlanKind) {
      this.sortBtnEl.addClass("todo-is-hidden");
      this.updateQuickPlaceholder();
      if (this.activePlanKind === 'life') {
        await this.renderLifePlanView();
      } else if (this.activePlanKind === 'year' || this.activePlanKind === 'month') {
        await this.renderGoalDashboard(this.activePlanKind);
      } else {
        await this.renderPlanView(this.activePlanKind);
      }
      return;
    }
    // My Day uses fixed time-group ordering and must never expose the global sort control.
    const isMyDayView = view === "myday" && !this.plugin.settings.selectedListId;
    this.sortBtnEl.toggleClass("todo-is-hidden", isMyDayView);
    this.taskListEl.removeClass("todo-goal-active");
    this.taskListEl.removeClass("todo-life-active");
    this.quickContainerEl.toggleClass("todo-is-hidden", this.plugin.settings.activeViewNav === "inbox");
    this.taskListEl.empty();

    

    let tasks: Task[] = [];

    if (view === "myday" && !this.plugin.settings.selectedListId) {
      const viewDate = this.myDayViewDate || localTodayStr();
      tasks = this.plugin.taskService.getAll().filter((t) => (!t.planKind || this.isScheduledWeekPlan(t)) && this.getTaskMyDayDate(t) === viewDate && !t.isDeleted && !t.isRecurrenceTemplate);
    } else if (view === "all") {
      tasks = this.plugin.taskService.getAll().filter((t) => !t.planKind || this.isScheduledWeekPlan(t));
    } else if (view === "inbox") {
      const defaultList = this.plugin.listService.getDefault();
      tasks = defaultList ? this.plugin.taskService.getInbox(defaultList.id).filter((t) => !t.planKind) : [];
    } else {
      const listId = this.plugin.settings.selectedListId;
      tasks = listId ? this.plugin.taskService.getByListId(listId).filter((t) => !t.planKind) : [];
    }

    // “我的一天”不使用全局状态筛选：它必须同时显示当天的进行中、已完成、搁置和放弃任务。
    // 其他任务视图继续沿用状态筛选设置。
    tasks = view === "myday"
      ? hideFutureRecurrenceInstances(tasks, localTodayStr())
      : hideFutureRecurrenceInstances(
        filterTasksByStatus(tasks, this.plugin.settings.taskFilterStatus || "active"),
        localTodayStr(),
      );

    const currentView = this.plugin.settings.selectedListId ? "list" : this.plugin.settings.activeViewNav;

    // My Day: render grouped view
    if (currentView === "myday") {
      await this.renderMyDayGroups(tasks);
      return;
    }


    // Apply review filter if active
    if (this.reviewFilter && view === "all") {
      const f = this.reviewFilter;
      if (f.type === "date" && f.dateField === "completedAt") {
        tasks = tasks.filter(t => t.isCompleted && t.completedAt && extractLocalDate(t.completedAt) === f.value);
      } else if (f.type === "date" && f.dateField === "dueDate") {
        tasks = tasks.filter(t => t.dueDate && extractLocalDate(t.dueDate) === f.value);
      } else if (f.type === "overdue") {
        const today = new Date();
        const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
        tasks = tasks.filter(t => !t.isCompleted && t.dueDate && extractLocalDate(t.dueDate) < todayStr);
      } else if (f.type === "tag") {
        tasks = tasks.filter(t => t.tags.includes(f.value));
      }
      // Render filter tag
      const filterTag = this.taskListEl.createDiv({ cls: "todo-review-filter-tag" });
      filterTag.createSpan({ cls: "todo-review-filter-tag-label", text: "筛选: " + f.label });
      const clearBtn = filterTag.createSpan({ cls: "todo-review-filter-tag-clear", text: "✕" });
      clearBtn.addEventListener("click", () => {
        this.reviewFilter = null;
        runAsyncAction(this.renderTasks("all"), "clear review filter");
      });
    }

    if (!tasks.length) {
      this.renderEmptyState(view);
      return;
    }

    // Quadrant mode: filter by selected quadrant
    if (this.plugin.settings.selectedQuadrant && !this.plugin.settings.selectedListId) {
      await this.renderQuadrantGroups();
      return;
    }

    const sorted = sortTasks(tasks, this.plugin.settings.sortConfig);
    const today = new Date();
    const todayStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    const overdue = sorted.filter((t) => !t.isCompleted && t.dueDate && extractLocalDate(t.dueDate) < todayStr);
    const incomplete = sorted.filter((t) => !t.isCompleted && !(t.dueDate && extractLocalDate(t.dueDate) < todayStr));
    const completed = sorted.filter((t) => t.isCompleted);


    incomplete.forEach((task) => this.renderTaskRow(this.taskListEl, task, currentView));
    // Overdue group
    if (overdue.length > 0) {
      const overdueGroup = this.taskListEl.createDiv({ cls: "todo-overdue-group" });
      const overdueHeader = overdueGroup.createDiv({ cls: "todo-overdue-header" });
      const overdueArrow = overdueHeader.createSpan({
        cls: "todo-overdue-arrow" + (this.plugin.settings.overdueCollapsed ? " collapsed" : ""),
        text: "▼",
      });
      overdueHeader.createSpan({ cls: "todo-overdue-label", text: "已逾期 " + overdue.length });
      const overdueList = overdueGroup.createDiv({ cls: "todo-overdue-list" });
      overdueList.toggleClass("todo-is-hidden", this.plugin.settings.overdueCollapsed);
      overdue.forEach((task) => this.renderTaskRow(overdueList, task, currentView));
      overdueHeader.addEventListener("click", () => { runAsyncAction((async () => {
        this.plugin.settings.overdueCollapsed = !this.plugin.settings.overdueCollapsed;
        overdueList.toggleClass("todo-is-hidden", this.plugin.settings.overdueCollapsed);
        overdueArrow.toggleClass("collapsed", this.plugin.settings.overdueCollapsed);
        await this.plugin.saveSettings();
      })(), "TodoView interaction"); });
    }


    if (completed.length) {
      const group = this.taskListEl.createDiv({ cls: "todo-completed-group" });
      const header = group.createDiv({ cls: "todo-completed-header" });
      const arrow = header.createSpan({
        cls: `todo-completed-arrow${this.plugin.settings.completedCollapsed ? " collapsed" : ""}`,
        text: "▼",
      });
      header.createSpan({ cls: "todo-completed-label", text: `已完成 ${completed.length}` });

      const list = group.createDiv({ cls: "todo-completed-list" });
      list.toggleClass("todo-is-hidden", this.plugin.settings.completedCollapsed);

      completed.forEach((task) => this.renderTaskRow(list, task, currentView));

      header.addEventListener("click", () => { runAsyncAction((async () => {
        this.plugin.settings.completedCollapsed = !this.plugin.settings.completedCollapsed;
        await this.plugin.saveSettings();
        list.toggleClass("todo-is-hidden", this.plugin.settings.completedCollapsed);
        arrow.toggleClass("collapsed", this.plugin.settings.completedCollapsed);
      })(), "TodoView interaction"); });
    }
  }

  private async renderQuadrantGroups(): Promise<void> {
    const allTasks = hideFutureRecurrenceInstances(
      filterTasksByStatus(
        this.plugin.taskService.getAll().filter((task) => !task.planKind || this.isScheduledWeekPlan(task)),
        this.plugin.settings.taskFilterStatus || "active",
      ),
      localTodayStr(),
    );
    const quadTags = this.plugin.tagService.getQuadrantTags();
    const config = this.plugin.settings.sortConfig;
    const selected = this.plugin.settings.selectedQuadrant;

    // If a specific quadrant is selected, show only that one
    if (selected) {
      const selectedTag = quadTags.find((t) => {
        const names = ["\u91cd\u8981\u7d27\u6025", "\u91cd\u8981\u4e0d\u7d27\u6025", "\u4e0d\u91cd\u8981\u7d27\u6025", "\u4e0d\u91cd\u8981\u4e0d\u7d27\u6025"];
        return names[t.sortOrder] === selected;
      });
      if (selectedTag) {
        const tasks = allTasks.filter((t) => t.tags.includes(selectedTag.id));
        const sorted = sortTasks(tasks, config);
        const incomplete = sorted.filter((t) => !t.isCompleted);
        const completed = sorted.filter((t) => t.isCompleted);
        incomplete.forEach((task) => this.renderTaskRow(this.taskListEl, task, "all"));
        if (completed.length) {
          const group = this.taskListEl.createDiv({ cls: "todo-completed-group" });
          const header = group.createDiv({ cls: "todo-completed-header" });
          const arrow = header.createSpan({ cls: "todo-completed-arrow" + (this.plugin.settings.completedCollapsed ? " collapsed" : ""), text: "\u25bc" });
          header.createSpan({ cls: "todo-completed-label", text: "\u5df2\u5b8c\u6210 " + completed.length });
          const list = group.createDiv({ cls: "todo-completed-list" });
          list.toggleClass("todo-is-hidden", this.plugin.settings.completedCollapsed);
          completed.forEach((task) => this.renderTaskRow(list, task, "all"));
          header.addEventListener("click", () => { runAsyncAction((async () => {
            this.plugin.settings.completedCollapsed = !this.plugin.settings.completedCollapsed;
            await this.plugin.saveSettings();
            list.toggleClass("todo-is-hidden", this.plugin.settings.completedCollapsed);
            arrow.toggleClass("collapsed", this.plugin.settings.completedCollapsed);
          })(), "TodoView interaction"); });
        }
      }
      return;
    }

    // No selection - show all quadrants
    const quadrantDefs = [
      { name: "\u91cd\u8981\u7d27\u6025", color: "#E74C3C", sortOrder: 0 },
      { name: "\u91cd\u8981\u4e0d\u7d27\u6025", color: "#4A90D9", sortOrder: 1 },
      { name: "\u4e0d\u91cd\u8981\u7d27\u6025", color: "#F5A623", sortOrder: 2 },
      { name: "\u4e0d\u91cd\u8981\u4e0d\u7d27\u6025", color: "#95A5A6", sortOrder: 3 },
    ];

    for (const qd of quadrantDefs) {
      const tag = quadTags.find((t) => t.sortOrder === qd.sortOrder);
      if (!tag) continue;
      const tasks = allTasks.filter((t) => t.tags.includes(tag.id));
      const sorted = sortTasks(tasks, config);
      const incomplete = sorted.filter((t) => !t.isCompleted);
      const completed = sorted.filter((t) => t.isCompleted);

      const groupEl = this.taskListEl.createDiv({ cls: "todo-myday-group" });
      const headerEl = groupEl.createDiv({ cls: "todo-myday-group-header" });
      if (qd.color) headerEl.style.borderLeft = "3px solid " + qd.color;
      headerEl.createSpan({ cls: "todo-myday-group-label", text: qd.name });
      headerEl.createSpan({ cls: "todo-myday-group-count", text: incomplete.length + "" });

      const listEl = groupEl.createDiv({ cls: "todo-myday-group-list" });
      incomplete.forEach((task) => this.renderTaskRow(listEl, task, "all"));
      completed.forEach((task) => this.renderTaskRow(listEl, task, "all"));
    }

    // Ungrouped tasks
    const ungrouped = allTasks.filter((t) => !quadTags.some((tag) => t.tags.includes(tag.id)));
    if (ungrouped.length > 0) {
      const sorted = sortTasks(ungrouped, config);
      const groupEl = this.taskListEl.createDiv({ cls: "todo-myday-group" });
      const headerEl = groupEl.createDiv({ cls: "todo-myday-group-header" });
      headerEl.createSpan({ cls: "todo-myday-group-label", text: "\u672a\u5206\u7c7b" });
      headerEl.createSpan({ cls: "todo-myday-group-count", text: sorted.length + "" });

      const listEl = groupEl.createDiv({ cls: "todo-myday-group-list" });
      sorted.forEach((task) => this.renderTaskRow(listEl, task, "all"));
    }
  }

private async renderMyDayGroups(tasks: Task[]): Promise<void> {

    // My Day navigation header
    const navHeader = this.taskListEl.createDiv({ cls: "todo-myday-nav" });
    const prevBtn = navHeader.createEl("button", { cls: "todo-myday-nav-btn", text: "\u25c0" });
    const dateLabel = navHeader.createSpan({ cls: "todo-myday-nav-title" });
    const nextBtn = navHeader.createEl("button", { cls: "todo-myday-nav-btn", text: "\u25b6" });
    const todayBtn = navHeader.createEl("button", { cls: "todo-myday-nav-today", text: "\u4eca\u5929" });

    const updateMyDayTitle = () => {
      const d = this.myDayViewDate || localTodayStr();
      const parts = d.split("-");
      const dowNames = ["\u5468\u65e5", "\u5468\u4e00", "\u5468\u4e8c", "\u5468\u4e09", "\u5468\u56db", "\u5468\u4e94", "\u5468\u516d"];
      const dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      const isToday = d === localTodayStr();
      dateLabel.textContent = (+parts[1]) + "\u6708" + (+parts[2]) + "\u65e5 " + dowNames[dt.getDay()] + (isToday ? " (\u4eca\u5929)" : "");
    };
    updateMyDayTitle();

    const refreshMyDay = async () => {
      this.taskListEl.empty();
      const newTasks = this.plugin.taskService.getAll().filter((t) => this.getTaskMyDayDate(t) === (this.myDayViewDate || localTodayStr()) && !t.isDeleted && !t.isRecurrenceTemplate);
      await this.renderMyDayGroups(newTasks);
    };

    prevBtn.addEventListener("click", () => { runAsyncAction((async () => {
      const currentDate = this.myDayViewDate || localTodayStr();
      const d = new Date(+currentDate.split("-")[0], +currentDate.split("-")[1] - 1, +currentDate.split("-")[2]);
      d.setDate(d.getDate() - 1);
      this.myDayViewDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      await refreshMyDay();
    })(), "TodoView interaction"); });
    nextBtn.addEventListener("click", () => { runAsyncAction((async () => {
      const currentDate = this.myDayViewDate || localTodayStr();
      const d = new Date(+currentDate.split("-")[0], +currentDate.split("-")[1] - 1, +currentDate.split("-")[2]);
      d.setDate(d.getDate() + 1);
      this.myDayViewDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      await refreshMyDay();
    })(), "TodoView interaction"); });
    todayBtn.addEventListener("click", () => { runAsyncAction((async () => {
      this.myDayViewDate = null;
      await refreshMyDay();
    })(), "TodoView interaction"); });

    // Auto-update myDayGroup based on time for tasks with dates
    for (const t of tasks) {
      if (t.startDate || t.dueDate) {
        const autoGroup = getMyDayGroupFromTime(t.startDate, t.dueDate);
        if (autoGroup !== (t.myDayGroup || "allday")) {
          t.myDayGroup = autoGroup;
          await this.plugin.taskService.update(t.id, { myDayGroup: autoGroup });
        }
      }
    }
    const sorted = sortTasks(tasks, this.plugin.settings.sortConfig);

    MYDAY_GROUPS.forEach(({ key, label }) => {
      const groupTasks = sorted.filter((t) => (t.myDayGroup || "allday") === key);
      const incomplete = groupTasks.filter((t) => !t.isCompleted);
      const completed = groupTasks.filter((t) => t.isCompleted);

      const groupEl = this.taskListEl.createDiv({ cls: "todo-myday-group" });
      const headerEl = groupEl.createDiv({ cls: "todo-myday-group-header" });
      headerEl.createSpan({ cls: "todo-myday-group-label", text: label });
      headerEl.createSpan({ cls: "todo-myday-group-count", text: `${incomplete.length}` });

      const listEl = groupEl.createDiv({ cls: "todo-myday-group-list" });
      incomplete.forEach((task) => this.renderTaskRow(listEl, task, "myday"));
      completed.forEach((task) => this.renderTaskRow(listEl, task, "myday"));
    });
    localizeDom(this.taskListEl);
  }

  refreshLanguageLabels(): void {
    if (this.sortLabelEl) {
      this.sortLabelEl.setText(this.getSortLabel(this.plugin.settings.sortConfig.primary.field));
    }
    if (this.filterBtnEl) {
      this.filterBtnEl.title = t("状态筛选");
      this.filterBtnEl.setAttribute("aria-label", t("状态筛选"));
    }
    const setItemLabel = (key: ViewNav, label: string) => {
      const item = this.navEls[key];
      if (!item) return;
      const labels = item.querySelectorAll<HTMLElement>(":scope > span:not(.todo-nav-icon)");
      const labelEl = labels[labels.length - 1];
      if (labelEl) labelEl.setText(label);
    };
    setItemLabel("myday", t("我的一天"));
    setItemLabel("all", t("所有任务"));
    setItemLabel("inbox", t("任务"));
    setItemLabel("schedule", t("我的日程"));

    this.planGroupEl?.querySelector<HTMLElement>(".todo-nav-group-name")?.setText(t("我的计划"));
    this.planGroupEl?.querySelectorAll<HTMLElement>(".todo-plan-name").forEach((el, index) => {
      el.setText([t("人生计划"), t("年度计划"), t("月度计划")][index] || el.textContent || "");
    });
    this.quadrantGroupEl?.querySelector<HTMLElement>(".todo-nav-group-name")?.setText(t("四象限"));
    const quadrantLabels = ["重要紧急", "重要不紧急", "不重要紧急", "不重要不紧急"];
    this.quadrantGroupEl?.querySelectorAll<HTMLElement>(".todo-quadrant-name").forEach((el, index) => {
      el.setText(t(quadrantLabels[index] || el.textContent || ""));
    });
    this.listNavEl?.querySelector<HTMLElement>(".todo-nav-add")?.setText(`+ ${t("新建列表")}`);

    const settingsButtons = this.containerEl.querySelectorAll<HTMLElement>(".todo-nav-settings-btn");
    const titles = ["设置", "复盘", "回收站", "新建分组"];
    settingsButtons.forEach((el, index) => { if (titles[index]) el.title = t(titles[index]); });
  }

  private renderTaskRow(container: HTMLDivElement, task: Task, currentView: "myday" | "all" | "inbox" | "trash" | "list" | "plan" | "schedule" | "review"): void {
    const row = container.createDiv({
      cls: `todo-task-item${task.isCompleted ? " completed" : ""}${task.isImportant ? " important-row" : ""}${task.status === "shelved" ? " todo-task-shelved" : ""}${task.status === "abandoned" ? " todo-task-abandoned" : ""}${this.plugin.settings.selectedTaskId === task.id ? " todo-task-selected" : ""}`,
    });
    row.dataset.taskId = task.id;

    const checkbox = row.createDiv({
      cls: `todo-checkbox${task.isCompleted ? " checked" : ""}`,
      text: task.isCompleted ? "✓" : "",
    });

    const content = row.createDiv({ cls: "todo-task-content" });
        if (task.status === "shelved") {
      const statusIcon = content.createSpan({ cls: "todo-task-status-icon" });
      setIcon(statusIcon, "pause-circle");
    } else if (task.status === "abandoned") {
      const statusIcon = content.createSpan({ cls: "todo-task-status-icon" });
      setIcon(statusIcon, "x-circle");
    }
    const title = content.createDiv({ cls: "todo-task-title", text: task.title || "未命名任务" });
    title.toggleClass("todo-task-muted", task.isCompleted);

    // Task metadata line
    const metaParts: string[] = [];
    // List name label
    const lists = this.plugin.listService.getActive();
    const taskList = lists.find((l) => l.id === task.listId);
    if (taskList) {
      metaParts.push(taskList.isDefault ? "任务" : taskList.name);
    } else {
      metaParts.push("任务");
    }
    // Date formatting helper
    const formatShortDate = (iso: string): string => {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const time = pad(d.getHours()) + ":" + pad(d.getMinutes());
      if (diff === 0) return "今天 " + time;
      if (diff === 1) return "明天 " + time;
      if (diff === -1) return "昨天 " + time;
      return (d.getMonth() + 1) + "/" + d.getDate() + " " + time;
    };
    // Build time range string
    const startStr = task.startDate ? formatShortDate(task.startDate) : "";
    const dueStr = task.dueDate ? formatShortDate(task.dueDate) : "";
    const metaRow = content.createDiv({ cls: "todo-task-meta-row" });
    const metaLeft = metaRow.createDiv({ cls: "todo-task-meta-left" });
    const metaRight = metaRow.createDiv({ cls: "todo-task-meta-right" });
    if (metaParts.length > 0) {
      metaLeft.createSpan({ text: metaParts[0] });
    }
    if (task.planKind !== "life" && (startStr || dueStr)) {
      metaLeft.createSpan({ cls: "todo-task-meta-dot", text: "\u00b7" });
      metaLeft.createSpan({ text: (startStr || ".") + " - " + (dueStr || ".") });
    }
    if (task.recurrence) {
      metaLeft.createSpan({ cls: "todo-task-meta-dot", text: "\u00b7" });
      const recIcon = metaLeft.createSpan({ cls: "todo-task-meta-icon" });
      setIcon(recIcon, "repeat");
    }
    const allTags = this.plugin.tagService.getAll();
    const taskTags = (task.tags || []).map((id) => allTags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
    const parentOf = this.plugin.taskService.getParentOf(task.id);
    if (parentOf) {
      const parentLabelMap: Record<string, string> = { life: "人生目标", year: "年度目标", quarter: "季度目标", month: "月度目标" };
      const parentLabel = parentLabelMap[parentOf.planKind ?? ""] ?? "上级目标";
      metaRight.createSpan({ cls: "todo-task-tag-label", text: parentLabel + "：" + parentOf.title });
    }
    if (taskTags.length > 0) {
      taskTags.forEach((tag, i) => {
        if (parentOf || i > 0) metaRight.createSpan({ cls: "todo-task-meta-dot", text: "\u00b7" });
        const tagEl = metaRight.createSpan({ cls: "todo-task-tag-label" });
        const tagIcon = tagEl.createSpan({ cls: "todo-task-tag-icon" });
        setIcon(tagIcon, tag.icon);
        tagEl.createSpan({ text: systemTagName(tag) });
      });
    }

    const star = row.createDiv({
      cls: `todo-star${task.isImportant ? " important" : ""}`,
    });
    setIcon(star, "star");

    checkbox.addEventListener("click", (ev) => { runAsyncAction((async () => {
      ev.stopPropagation();
      if (task.isCompleted) {
        await this.plugin.taskService.uncomplete(task.id);
      } else {
        await this.plugin.taskService.complete(task.id);
      }
      this.refreshDetailIfActive(task.id);
      await this.renderTasks(currentView);
    })(), "TodoView interaction"); });

    star.addEventListener("click", (ev) => { runAsyncAction((async () => {
      ev.stopPropagation();
      await this.plugin.taskService.update(task.id, { isImportant: !task.isImportant });
      this.refreshDetailIfActive(task.id);
      await this.renderTasks(currentView);
    })(), "TodoView interaction"); });

    row.addEventListener("click", () => { runAsyncAction((async () => {
      this.detailView.clearHistory();
      this.plugin.settings.selectedTaskId = task.id;
      await this.plugin.saveSettings();
      this.detailView.open(task.id);
      this.highlightSelectedTask(task.id);
      const layout = this.containerEl.querySelector(".todo-layout");
      if (layout) layout.addClass("todo-layout-detail-open");
    })(), "TodoView interaction"); });

    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      this.showTaskContextMenu(ev, task, currentView);
    });
  }

  
  private renderEmptyState(view: "myday" | "all" | "inbox" | "trash" | "list" | "plan" | "schedule" | "review"): void {
    const empty = this.taskListEl.createDiv({ cls: "todo-empty-state todo-guide" });

    if (view === "myday") {
      empty.createDiv({ cls: "todo-empty-title", text: t("今天还没有安排") });
      empty.createDiv({ cls: "todo-empty-desc", text: t("从下方输入一个任务，或从其它列表把重要事项加入今天计划。") });
      const action = empty.createDiv({ cls: "todo-empty-action", text: t("添加一个今日任务") });
      action.addEventListener("click", () => {
        void this.promptQuickCreate();
      });
      return;
    }

    if (view === "all") {
      empty.createDiv({ cls: "todo-empty-title", text: t("还没有任务") });
      empty.createDiv({ cls: "todo-empty-desc", text: t("在输入框里写下第一件要做的事，按回车即可创建。") });
      const action = empty.createDiv({ cls: "todo-empty-action", text: t("立即创建任务") });
      action.addEventListener("click", () => {
        void this.promptQuickCreate();
      });
      return;
    }

    if (view === "inbox") {
      empty.createDiv({ cls: "todo-empty-title", text: t("任务是空的") });
      empty.createDiv({ cls: "todo-empty-desc", text: t("将任务从其他列表移动到此处，或右键任务选择“移动到任务”。") });
      return;
    }

    empty.createDiv({ cls: "todo-empty-title", text: t("当前列表是空的") });
    empty.createDiv({ cls: "todo-empty-desc", text: t("给这个清单起一个明确目标，然后先添加第一件最小行动项。") });
    const action = empty.createDiv({ cls: "todo-empty-action", text: t("为当前列表新增任务") });
    action.addEventListener("click", () => {
      void this.promptQuickCreate();
    });
  }

  private async createListByInput(): Promise<void> {
    const result = await new CreateListModal(this.app, undefined, this.plugin.tagService.getAll()).openAndGetValue();
    if (!result?.name?.trim()) {
      return;
    }

    const created = await this.plugin.listService.create({ name: result.name.trim(), icon: result.icon, tags: result.tags });
    await this.renderLists();
    await this.activateList(created.id);
  }

  private async renameListInline(listId: string, currentName: string, row: HTMLDivElement): Promise<void> {
    const nameEl = row.querySelector<HTMLElement>(".todo-list-name");
    if (!nameEl) return;

    const input = nameEl.createEl("input", { cls: "todo-list-rename-input" });
    input.value = currentName;
    nameEl.replaceWith(input);
    input.focus();

    const commit = async () => {
      const next = input.value.trim() || currentName;
      await this.plugin.listService.rename(listId, next);
      await this.renderLists();
    };

    input.addEventListener("blur", () => {
      void commit();
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void commit();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        void this.renderLists();
      }
    });
  }

  focusQuickInput(): void {
    if (!this.quickInputEl) {
      runAsyncAction(this.promptQuickCreate(), "create quick task");
      return;
    }

    this.quickInputEl.scrollIntoView({ behavior: "smooth", block: "end" });
    this.quickInputEl.focus({ preventScroll: true });

    if (document.activeElement !== this.quickInputEl) {
      runAsyncAction(this.promptQuickCreate(), "create quick task");
    }
  }

  private updateQuickPlaceholder(): void {
    const { activeViewNav, selectedListId } = this.plugin.settings;
    if (activeViewNav === "plan") {
      this.quickContainerEl.removeClass("todo-is-hidden");
      const pk = this.activePlanKind;
      if (pk === "life") this.quickInputEl.placeholder = "新建人生目标...";
      else if (pk === "year") this.quickInputEl.placeholder = "新建年度目标...";
      else if (pk === "month") this.quickInputEl.placeholder = "新建月度目标...";
      else this.quickInputEl.placeholder = "新建任务...";
      localizeDom(this.containerEl);
      return;
    }
    this.quickContainerEl.toggleClass("todo-is-hidden", activeViewNav === "inbox");
    if (activeViewNav === "myday") {
      this.quickInputEl.placeholder = "添加任务到我的一天...";
      localizeDom(this.containerEl);
      return;
    }
    if (activeViewNav === "all") {
      this.quickInputEl.placeholder = "添加任务...";
      localizeDom(this.containerEl);
      return;
    }
    if (activeViewNav === "inbox") {
      this.quickInputEl.placeholder = "添加任务到任务...";
      localizeDom(this.containerEl);
      return;
    }
    if (selectedListId) {
      const list = this.plugin.listService.getActive().find((l) => l.id === selectedListId);
      this.quickInputEl.placeholder = list ? `添加任务到「${list.name}」...` : "添加任务到当前列表...";
      localizeDom(this.containerEl);
      return;
    }
    this.quickInputEl.placeholder = "添加任务...";
    localizeDom(this.containerEl);
  }

  
  async promptQuickCreate(): Promise<void> {
    const title = await new PromptModal(this.app, "输入任务标题").openAndGetValue();
    if (!title?.trim()) {
      return;
    }


    const { activeViewNav, selectedListId } = this.plugin.settings;

    // Mobile quick-input uses this prompt path. Keep plan creation identical
    // to the desktop quick-input path so goals are not saved as plain tasks.
    if (activeViewNav === "plan" && this.activePlanKind) {
      const kind = this.activePlanKind;
      if (kind === "life") {
        await this.plugin.taskService.create({ title: title.trim(), planKind: "life" });
        await this.renderLifePlanView();
      } else {
        await this.plugin.taskService.create({ title: title.trim(), planKind: kind, planPeriodKey: this.goalDashboardRenderer.periodKey ?? currentPeriodKey(kind) });
        if (kind === "year" || kind === "month") await this.renderGoalDashboard(kind);
        else await this.renderPlanView(kind);
      }
      return;
    }

    let listId = selectedListId || undefined;

    if (!listId) {
      const defaultList = this.plugin.listService.getDefault();
      listId = defaultList?.id;
    }

    if (!listId) {
      return;
    }

    await this.plugin.taskService.create({
      title: title.trim(),
      listId,
      startDate: activeViewNav === "myday" && !selectedListId ? (this.myDayViewDate || localTodayStr()) + "T07:00:00" : null,
      dueDate: activeViewNav === "myday" && !selectedListId ? (this.myDayViewDate || localTodayStr()) + "T23:30:00" : null,
    });
    await this.renderLists();
    await this.renderTasks(selectedListId ? "list" : activeViewNav);
  }

  private async createTaskFromQuickInput(): Promise<void> {
    const title = this.quickInputEl.value.trim();
    if (!title) return;

    // Plan view: create plan task
    if (this.plugin.settings.activeViewNav === "plan" && this.activePlanKind) {
      const kind = this.activePlanKind;
      if (kind === "life") {
        await this.plugin.taskService.create({ title, planKind: "life" });
      } else {
        await this.plugin.taskService.create({ title, planKind: kind, planPeriodKey: this.goalDashboardRenderer.periodKey! });
      }
      this.quickInputEl.value = "";
      if (kind === "life") await this.renderLifePlanView();
      else if (kind === "year" || kind === "month") await this.renderGoalDashboard(kind);
      else await this.renderPlanView(kind);
      return;
    }



    const { activeViewNav, selectedListId } = this.plugin.settings;
    let listId = selectedListId || undefined;

    if (!listId) {
      const defaultList = this.plugin.listService.getDefault();
      listId = defaultList?.id;
    }

    if (!listId) {
      return;
    }

    const isMyDay = activeViewNav === "myday" && !selectedListId;
    const selectedDate = this.myDayViewDate || localTodayStr();
    const listTags = this.plugin.listService.getById(listId)?.tags || [];
    await this.plugin.taskService.create({
      title,
      listId,
      tags: [...listTags],
      startDate: isMyDay ? selectedDate + "T07:00:00" : null,
      dueDate: isMyDay ? selectedDate + "T23:30:00" : null,
    });

    this.quickInputEl.value = "";
    await this.renderLists();
    await this.renderTasks(selectedListId ? "list" : activeViewNav);
  }




  private async activatePlan(kind: PlanKind): Promise<void> {
    this.closeDetail();
    this.taskListEl.removeClass("todo-life-active");
    this.taskListEl.removeClass("todo-goal-active");
    this.taskListEl.removeClass("todo-review-active");
    this.taskListEl.removeClass("todo-schedule-active");
    this.taskListEl.removeClass("todo-trash-active");
    this.plugin.settings.activeViewNav = "plan";
    this.plugin.settings.selectedListId = null;
    this.plugin.settings.selectedQuadrant = null;
    this.plugin.settings.activePlanKind = kind;
    this.activePlanKind = kind;
    await this.plugin.saveSettings();
    Object.entries(this.navEls).forEach(([, el]) => el.removeClass("active"));
    this.listItemsEl?.querySelectorAll<HTMLDivElement>(".todo-nav-item").forEach((el) => el.removeClass("active"));
    this.quadrantGroupEl?.querySelectorAll<HTMLDivElement>(".todo-quadrant-item").forEach((el) => el.removeClass("active"));
    const planListEl = this.planGroupEl?.querySelector(".todo-nav-group-list") as HTMLElement;
    if (planListEl) planListEl.querySelectorAll(".todo-plan-item").forEach((el: Element, i: number) => {
      el.toggleClass("active", (kind === "life" && i === 0) || (kind === "year" && i === 1) || (kind === "month" && i === 2));
    });
    this.sortBtnEl.addClass("todo-is-hidden");
    this.updateQuickPlaceholder();
    this.taskListEl.empty();
    if (kind === "life") {
      await this.renderLifePlanView();
    } else if (kind === "year" || kind === "month") {
      await this.renderGoalDashboard(kind);
    } else {
      await this.renderPlanView(kind);
    }
    this.updateHeaderInfo();
    this.showMobilePanel("main");
  }

  /** Navigate to a task: switch plan view + highlight + scroll + open detail */
  async navigateToTask(taskId: string): Promise<void> {
    const task = this.plugin.taskService.getAll().find((t) => t.id === taskId);
    if (!task) return;

    // Switch navigation to the target plan/list view
    if (task.planKind) {
      await this.activatePlan(task.planKind);
      // Expand the correct parent group + sub-group for the target task
      this.expandPlanGroupForTask(task);
    } else {
      // Non-plan task: navigate to its list
      const listId = task.listId;
      if (listId) {
        await this.activateList(listId);
      }
    }

    // Highlight and select the target task
    this.plugin.settings.selectedTaskId = taskId;
    await this.plugin.saveSettings();
    this.highlightSelectedTask(taskId);
    this.scrollTaskIntoView(taskId);

    // Open detail panel
    this.detailView.open(taskId);
    const layout = this.containerEl.querySelector(".todo-layout");
    if (layout) layout.addClass("todo-layout-detail-open");
  }

  /** Expand parent group and sub-group to reveal a target task in plan view */
  private expandPlanGroupForTask(task: Task): void {
    if (!task.planPeriodKey) return;
    if (task.planKind === "life") return; // life view has no collapsible groups

    // Expand the body that directly matches the task's period key
    const directBody = this.taskListEl?.querySelector<HTMLElement>(`[data-period-key="${task.planPeriodKey}"]`);
    if (directBody) {
      directBody.removeClass("todo-is-hidden");
      const arrow = directBody.parentElement?.querySelector(".todo-plan-group-arrow");
      if (arrow) arrow.removeClass("collapsed");
    }

    // If the plan view has sub-periods, also expand the parent group containing this task
    const subKind: PlanKind | null = this.activePlanKind === "year" ? "quarter" : this.activePlanKind === "month" ? "week" : null;
    if (subKind && task.planPeriodKey) {
      const parentKey = getParentPeriodKey(subKind, task.planPeriodKey);
      if (parentKey) {
    const parentBody = this.taskListEl?.querySelector<HTMLElement>(`[data-period-key="${parentKey}"]`);
        if (parentBody) {
          parentBody.removeClass("todo-is-hidden");
          const parentArrow = parentBody.parentElement?.querySelector(".todo-plan-group-arrow");
          if (parentArrow) parentArrow.removeClass("collapsed");
        }
      }
    }
  }

  /** Scroll a task row into the visible area of the task list */
  scrollTaskIntoView(taskId: string): void {
    const el = this.taskListEl?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private async renderPlanView(kind: PlanKind): Promise<void> {
    this.taskListEl.removeClass("todo-life-active");
    this.taskListEl.removeClass("todo-goal-active");
    this.taskListEl.empty();
    this.planGroupRenderer.renderPlan(this.taskListEl, kind);
  }

  private renderGoalDashboard(kind: "year" | "month", preserveScrollPosition = false): Promise<void> {
    return this.goalDashboardRenderer.renderGoalDashboard(kind, preserveScrollPosition);
  }

  private renderLifePlanView(): Promise<void> {
    return this.lifePlanRenderer.render(this.taskListEl, this.plugin.settings.birthday);
  }

  private async openPlanTask(taskId: string): Promise<void> {
    this.detailView.clearHistory();
    this.plugin.settings.selectedTaskId = taskId;
    await this.plugin.saveSettings();
    this.detailView.open(taskId);
    this.highlightSelectedTask(taskId);
    const layout = this.containerEl.querySelector(".todo-layout");
    if (layout) layout.addClass("todo-layout-detail-open");
  }


  private localizedPeriodLabel(kind: PlanKind, key: string): string {
    return getLocalizedPeriodLabel(kind, key, isEnglish());
  }

  private localizedSubGroupLabel(kind: PlanKind, key: string): string {
    return getLocalizedSubGroupLabel(kind, key, isEnglish());
  }

  private getScheduleTitle(): string {
    const dowNames = isEnglish() ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    switch (this.scheduleMode) {
      case "month":
        return isEnglish() ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(this.scheduleYear, this.scheduleMonth, 1)) : this.scheduleYear + "年" + (this.scheduleMonth + 1) + "月";
      case "day": {
        const d = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
        return isEnglish() ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d) + "|" + dowNames[d.getDay()] : (this.scheduleMonth + 1) + "月" + this.scheduleDate + "日" + "|" + dowNames[d.getDay()];
      }
      case "week": {
        const d = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
        const wn = getISOWeekNumber(d);
        return isEnglish() ? this.scheduleYear + "|Week " + wn : this.scheduleYear + "年" + "|" + "第" + wn + "周";
      }
    }
  }

  private updateScheduleTitle(el: HTMLElement): void {
    const raw = this.getScheduleTitle();
    const parts = raw.split("|");
    el.empty();
    if (parts.length === 2 && this.isMobile()) {
      el.createDiv({ cls: "todo-schedule-title-line1", text: parts[0] });
      el.createDiv({ cls: "todo-schedule-title-line2", text: parts[1] });
    } else {
      el.textContent = parts.join("");
    }
    localizeDom(this.taskListEl);
    localizeDom(el);
  }

  private async syncListTags(listId: string, listTags: string[]): Promise<void> {
    const requiredTags = [...new Set(listTags)];
    const tasks = this.plugin.taskService.getByListId(listId);
    for (const task of tasks) {
      const mergedTags = [...new Set([...(task.tags || []), ...requiredTags])];
      if (mergedTags.length !== (task.tags || []).length) {
        await this.plugin.taskService.update(task.id, { tags: mergedTags });
      }
    }
  }

  private async navigateFromScheduleSidebar(taskId: string): Promise<void> {
    const task = this.plugin.taskService.getAll().find((item) => item.id === taskId);
    if (!task) return;

    this.scheduleSidebarOpen = false;
    this.detailView.close();
    const layout = this.containerEl.querySelector(".todo-layout");
    if (layout) layout.removeClass("todo-layout-detail-open");
    this.showMobilePanel("main");

    if (this.scheduleMode === "day") {
      await this.activateNav("myday");
      const selectedDate = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
      this.myDayViewDate = selectedDate.getFullYear() + "-" + String(selectedDate.getMonth() + 1).padStart(2, "0") + "-" + String(selectedDate.getDate()).padStart(2, "0");
      await this.renderTasks("myday");
    } else if (task.planKind) {
      await this.activatePlan(task.planKind);
      this.expandPlanGroupForTask(task);
    }

    this.plugin.settings.selectedTaskId = taskId;
    await this.plugin.saveSettings();
    this.highlightSelectedTask(taskId);
    this.scrollTaskIntoView(taskId);
  }

  private openScheduleSidebar(refreshOnly = false): void {
    this.scheduleSidebarOpen = true;
    const mode = this.scheduleMode;
    if (!Number.isFinite(this.scheduleYear) || !Number.isFinite(this.scheduleMonth) || !Number.isFinite(this.scheduleDate)) {
      const now = new Date();
      this.scheduleYear = now.getFullYear();
      this.scheduleMonth = now.getMonth();
      this.scheduleDate = now.getDate();
    }
    const selectedDate = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
    const dateStr = selectedDate.getFullYear() + "-" + String(selectedDate.getMonth() + 1).padStart(2, "0") + "-" + String(selectedDate.getDate()).padStart(2, "0");
    const allTasks = this.plugin.taskService.getAll().filter((task) => !task.isDeleted && !task.isRecurrenceTemplate);
    let title = this.getScheduleTitle().replace("|", " ");
    let items: ScheduleSidebarItem[] = [];

    if (mode === "day") {
      title = isEnglish() ? "Tasks for " + title : title + " 待办";
      items = allTasks
        .filter((task) => this.getTaskMyDayDate(task) === dateStr)
        .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.title.localeCompare(b.title))
        .map((task) => ({
          id: task.id,
          title: task.title,
          subtitle: task.dueDate ? task.dueDate.replace("T", " ").slice(0, 16) : (isEnglish() ? "My Day" : "我的一天"),
          isCompleted: task.isCompleted,
          status: task.status,
        }));
    } else {
      const kind: PlanKind = mode === "week" ? "week" : "month";
      const periodKey = getPeriodKeyForDate(selectedDate, kind);
      title = isEnglish() ? (kind === "week" ? "Weekly goals" : "Monthly goals") : (kind === "week" ? "本周目标" : "本月目标");
      items = allTasks
        .filter((task) => task.planKind === kind && task.planPeriodKey === periodKey)
        .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.title.localeCompare(b.title))
        .map((task) => ({
          id: task.id,
          title: task.title,
          subtitle: periodKey,
          isCompleted: task.isCompleted,
          status: task.status,
        }));
    }

    this.plugin.settings.selectedTaskId = null;
    if (refreshOnly) this.detailView.updateScheduleSummary(title, items);
    else this.detailView.openScheduleSummary(title, items);
  }

  private refreshScheduleSidebarIfOpen(): void {
    if (!this.isMobileEnvironment()) return;
    if (!this.scheduleSidebarOpen) return;
    this.openScheduleSidebar(true);
  }

  private normalizeScheduleDate(): void {
    const d = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
    this.scheduleYear = d.getFullYear();
    this.scheduleMonth = d.getMonth();
    this.scheduleDate = d.getDate();
  }

  private layoutOverlapTasks(tasks: Task[]): { task: Task; col: number; totalCols: number }[] {
    return layoutOverlappingTasks(tasks);
  }

  private lightenColor(hex: string, factor: number): string {
    if (!hex || hex.length < 7) return hex;
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    const lr = Math.round(r + (255 - r) * factor);
    const lg = Math.round(g + (255 - g) * factor);
    const lb = Math.round(b + (255 - b) * factor);
    return "#" + [lr, lg, lb].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  private getTaskBlockColor(task: Task): string {
    const allTags = this.plugin.tagService.getAll();
    const colorTag = task.tags
      .map(id => allTags.find(t => t.id === id && t.sortOrder >= 4))
      .find(Boolean);
    const raw = colorTag?.color || "#4A90D9";
    return this.lightenColor(raw, 0.45);
  }

  private renderTrashView(): void {
    const container = this.taskListEl;
    container.empty();

    const header = container.createDiv({ cls: "todo-trash-header" });
    const headerText = header.createDiv({ cls: "todo-trash-header-text" });
    headerText.createEl("h2", { text: t("\u56de\u6536\u7ad9") });
    const desc = headerText.createDiv({ cls: "todo-trash-desc" });
    desc.createSpan({ text: t("\u5df2\u5220\u9664\u7684\u4efb\u52a1\u5c06\u4fdd\u7559 30 \u5929\uff0c\u4e4b\u540e\u81ea\u52a8\u6e05\u7406") });

    const emptyBtn = header.createEl("button", { text: t("\u6e05\u7a7a\u56de\u6536\u7ad9"), cls: "todo-trash-btn todo-trash-btn-danger todo-trash-header-btn" });
    emptyBtn.addEventListener("click", () => { runAsyncAction((async () => {
      const confirmed = await new ConfirmModal(this.app, t("确定永久删除回收站中的任务吗？此操作不可撤销。") + " (" + deletedTasks.length + t("个任务") + ")").openAndConfirm();
      if (confirmed) {
        await this.plugin.taskService.emptyTrash();
        this.renderTrashView();
      }
    })(), "TodoView interaction"); });


    const deletedTasks = this.plugin.taskService.getDeleted();

    if (deletedTasks.length === 0) {
      const empty = container.createDiv({ cls: "todo-trash-empty" });
      empty.createDiv({ text: t("回收站是空的") });
      return;
    }

    const stats = container.createDiv({ cls: "todo-trash-stats" });
    stats.createSpan({ text: t("共") + " " + deletedTasks.length + t("个任务") });

    const list = container.createDiv({ cls: "todo-trash-list" });
    for (const task of deletedTasks) {
      const row = list.createDiv({ cls: "todo-trash-item" });
      const info = row.createDiv({ cls: "todo-trash-item-info" });
      info.createDiv({ cls: "todo-trash-item-title", text: task.title || t("未命名任务") });
      const meta = info.createDiv({ cls: "todo-trash-item-meta" });
      if (task.deletedAt) {
        const deleteDate = new Date(task.deletedAt);
        meta.createSpan({ text: t("删除于") + " " + deleteDate.toLocaleString(isEnglish() ? "en-US" : "zh-CN") });
      }

      const actions = row.createDiv({ cls: "todo-trash-item-actions" });
      const restoreBtn = actions.createEl("button", { text: t("恢复"), cls: "todo-trash-btn" });
      restoreBtn.addEventListener("click", () => { runAsyncAction((async () => {
        await this.plugin.taskService.restore(task.id);
        this.renderTrashView();
      })(), "TodoView interaction"); });
      const deleteBtn = actions.createEl("button", { text: t("彻底删除"), cls: "todo-trash-btn todo-trash-btn-danger" });
      deleteBtn.addEventListener("click", () => { runAsyncAction((async () => {
        const confirmed = await new ConfirmModal(this.app, t("确定永久删除吗？此操作不可撤销。") + " " + (task.title || t("未命名任务"))).openAndConfirm();
        if (confirmed) {
          await this.plugin.taskService.hardDelete(task.id);
          this.renderTrashView();
        }
      })(), "TodoView interaction"); });
    }

  }
  private renderScheduleView(): void {
    if (this.timeLineTimer) { window.clearInterval(this.timeLineTimer); this.timeLineTimer = null; }
    const container = this.taskListEl;
    container.empty();
    const wrap = container.createDiv({ cls: "todo-schedule-container" });

    const header = wrap.createDiv({ cls: "todo-schedule-header" });
    const nav = header.createDiv({ cls: "todo-schedule-nav" });
    const prevBtn = nav.createEl("button", { cls: "todo-schedule-prev", text: "◀" });
    const titleEl = nav.createSpan({ cls: "todo-schedule-title", text: this.getScheduleTitle() });
    const nextBtn = nav.createEl("button", { cls: "todo-schedule-next", text: "▶" });
    const todayBtn = nav.createEl("button", { cls: "todo-schedule-today-btn", text: "今天" });

    const updateView = () => {
      this.updateScheduleTitle(titleEl);
      this.renderScheduleContent(contentEl);
      this.refreshScheduleSidebarIfOpen();
    };

    prevBtn.addEventListener("click", () => {
      if (this.scheduleMode === "month") { this.scheduleMonth--; if (this.scheduleMonth < 0) { this.scheduleMonth = 11; this.scheduleYear--; } }
      else if (this.scheduleMode === "day") { this.scheduleDate--; this.normalizeScheduleDate(); }
      else { this.scheduleDate -= 7; this.normalizeScheduleDate(); }
      updateView();
    });
    nextBtn.addEventListener("click", () => {
      if (this.scheduleMode === "month") { this.scheduleMonth++; if (this.scheduleMonth > 11) { this.scheduleMonth = 0; this.scheduleYear++; } }
      else if (this.scheduleMode === "day") { this.scheduleDate++; this.normalizeScheduleDate(); }
      else { this.scheduleDate += 7; this.normalizeScheduleDate(); }
      updateView();
    });
    todayBtn.addEventListener("click", () => {
      const now = new Date();
      this.scheduleYear = now.getFullYear();
      this.scheduleMonth = now.getMonth();
      this.scheduleDate = now.getDate();
      updateView();
    });

    const switchEl = header.createDiv({ cls: "todo-schedule-mode-switch" });
    const modes = ["day", "week", "month"] as const;
    const modeLabels: Record<string, string> = { day: "日", week: "周", month: "月" };
    for (const m of modes) {
      const btn = switchEl.createSpan({
        cls: "todo-schedule-mode-btn" + (m === this.scheduleMode ? " active" : ""),
        text: modeLabels[m],
      });
      btn.addEventListener("click", () => { runAsyncAction((async () => {
        this.scheduleMode = m;
        this.plugin.settings.activeScheduleMode = m;
        await this.plugin.saveSettings();
        switchEl.querySelectorAll(".todo-schedule-mode-btn").forEach((el) => el.removeClass("active"));
        btn.addClass("active");
        this.updateScheduleTitle(titleEl);
        this.scheduleScrollTarget = "now";
        this.renderScheduleContent(contentEl);
        this.refreshScheduleSidebarIfOpen();
      })(), "TodoView interaction"); });
    }

    const contentEl = wrap.createDiv({ cls: "todo-schedule-content" });
    this.renderScheduleContent(contentEl);
  }

  private renderScheduleContent(container: HTMLDivElement): void {
    if (this.timeLineTimer) { window.clearInterval(this.timeLineTimer); this.timeLineTimer = null; }
    container.empty();
    switch (this.scheduleMode) {
      case "month":
        this.scheduleRenderer.renderMonth(container, {
          year: this.scheduleYear,
          month: this.scheduleMonth,
          date: this.scheduleDate,
        });
        break;
      case "day":
        this.scheduleRenderer.renderDay(container, {
          year: this.scheduleYear,
          month: this.scheduleMonth,
          date: this.scheduleDate,
        });
        break;
      case "week":
        this.scheduleRenderer.renderWeek(container, {
          year: this.scheduleYear,
          month: this.scheduleMonth,
          date: this.scheduleDate,
        });
        break;
    }
  }

  private renderScheduleTaskCard(container: HTMLElement, task: Task): void {
    const sd = new Date(task.startDate!);
    const ed = new Date(task.dueDate!);
    const pad = (n: number) => String(n).padStart(2, "0");
    const timeStr = pad(sd.getHours()) + ":" + pad(sd.getMinutes()) + " - " + pad(ed.getHours()) + ":" + pad(ed.getMinutes());
    const blockColor = this.getTaskBlockColor(task);

    const card = container.createDiv({ cls: "todo-time-event-block" + (task.isCompleted ? " todo-schedule-completed" : "") });
    card.dataset.taskId = task.id;
    card.style.backgroundColor = blockColor;
    const textColor = this.getContrastColor(blockColor);
    card.style.color = textColor;
    card.createDiv({ cls: "todo-event-time", text: timeStr });
    const titleRow = card.createDiv({ cls: "todo-event-title-row" });
    if (task.recurrence) {
      const recIcon = titleRow.createSpan({ cls: "todo-event-recurrence-icon" });
      setIcon(recIcon, "repeat");
    }
    titleRow.createSpan({ cls: "todo-event-title", text: task.title });
    card.createDiv({ cls: "todo-resize-handle" });

    card.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      const rect = card.getBoundingClientRect();
      const isResize = (ev.clientY - rect.top) > rect.height - 8;
      const startMin = sd.getHours() * 60 + sd.getMinutes();
      const endMin = ed.getHours() * 60 + ed.getMinutes();
      const dateStr = extractLocalDate(task.dueDate!);
      const hourHeight = 60;

      // Cross-day detection for week view
    const columnsEl = container.closest<HTMLElement>(".todo-week-columns");
      const colCount = columnsEl ? columnsEl.children.length : 1;
      const columnsRect = columnsEl ? columnsEl.getBoundingClientRect() : null;
      const dateStrs: string[] = [];
      let currentColIdx = 0;
      if (columnsEl) {
        for (let ci = 0; ci < columnsEl.children.length; ci++) {
          const cEl = columnsEl.children[ci] as HTMLElement;
    const firstCard = cEl.querySelector<HTMLElement>("[data-date-str]");
          if (firstCard) dateStrs.push(firstCard.dataset.dateStr!);
          else {
            // Derive date from weekStart offset
            const refDate = new Date(this.scheduleYear, this.scheduleMonth, this.scheduleDate);
            const dow = refDate.getDay() || 7;
            const ws = new Date(refDate); ws.setDate(refDate.getDate() - dow + 1);
            const cd = new Date(ws); cd.setDate(ws.getDate() + ci);
            dateStrs.push(cd.getFullYear() + "-" + String(cd.getMonth() + 1).padStart(2, "0") + "-" + String(cd.getDate()).padStart(2, "0"));
          }
          if (cEl.contains(card)) currentColIdx = ci;
        }
      }

      // Create ghost in columns container for week view (cross-day drag)
      const ghostParent = columnsEl || container;
      const ghost = ghostParent.createDiv({ cls: "todo-drag-ghost" });
      ghost.style.backgroundColor = blockColor;
      let ghostBaseLeft = 0;
      if (columnsEl && columnsRect) {
        // Week view: position ghost relative to columns container
        const colWidth = columnsRect.width / colCount;
        const colRect = container.getBoundingClientRect();
        const cardLeftInCol = card.getBoundingClientRect().left - colRect.left;
        ghostBaseLeft = currentColIdx * colWidth + cardLeftInCol;
        ghost.style.left = ghostBaseLeft + "px";
        ghost.style.width = card.getBoundingClientRect().width + "px";
        ghost.style.top = card.style.top;
        ghost.style.height = card.style.height;
      } else {
        // Day view: keep original positioning
        ghost.style.left = card.style.left;
        ghost.style.width = card.style.width;
        ghost.style.top = card.style.top;
        ghost.style.height = card.style.height;
      }

      // Find scroll container for auto-scroll
      const scrollContainer = columnsEl
      ? container.closest<HTMLElement>(".todo-schedule-week-grid")
      : container.closest<HTMLElement>(".todo-time-grid");
      this.dragState = {
        type: isResize ? "resize" : "move",
        taskId: task.id,
        startY: ev.clientY,
        startX: ev.clientX,
        origStartMin: startMin,
        origEndMin: endMin,
        dateStr,
        hourHeight,
        ghost,
        card,
        moved: false,
        colCount,
        columnsRect,
        dateStrs,
        currentColIdx,
        ghostBaseLeft,
        scrollContainer,
        scrollRAF: null,
        source: "timeline" as const,
        origScrollTop: scrollContainer?.scrollTop || 0,
        columnsEl: columnsEl || null,
      };
      card.addClass("dragging");
    });
  }

  private startAllDayDrag(event: MouseEvent, task: Task, card: HTMLElement, grid: HTMLDivElement, dateStr: string): void {
    const ghost = grid.createDiv({ cls: "todo-drag-ghost todo-drag-ghost-day" });
    ghost.style.backgroundColor = this.getTaskBlockColor(task);
    this.dragState = {
      type: "move",
      taskId: task.id,
      startY: event.clientY,
      startX: event.clientX,
      origStartMin: 0,
      origEndMin: 60,
      dateStr,
      hourHeight: 60,
      ghost,
      card,
      moved: false,
      colCount: 1,
      columnsRect: null,
      dateStrs: [dateStr],
      currentColIdx: 0,
      ghostBaseLeft: 0,
      scrollContainer: grid,
      scrollRAF: null,
      source: "allday",
      origScrollTop: grid.scrollTop || 0,
      columnsEl: null,
    };
    card.addClass("dragging");
  }

  private startWeekAllDayDrag(event: MouseEvent, task: Task, card: HTMLElement, grid: HTMLDivElement, weekStart: Date, columnIndex: number): void {
    const columnsEl = grid.querySelector<HTMLElement>(".todo-week-columns");
    const ghostParent = columnsEl || grid;
    const ghost = ghostParent.createDiv({ cls: "todo-drag-ghost todo-drag-ghost-week" });
    const colCount = 7;
    const columnsRect = columnsEl?.getBoundingClientRect() || null;
    const colWidth = columnsRect ? columnsRect.width / colCount : 0;
    const dateStrs = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + index);
      return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    });
    ghost.style.backgroundColor = this.getTaskBlockColor(task);
    ghost.style.left = columnIndex * colWidth + "px";
    ghost.style.width = colWidth + "px";
    this.dragState = {
      type: "move",
      taskId: task.id,
      startY: event.clientY,
      startX: event.clientX,
      origStartMin: 0,
      origEndMin: 60,
      dateStr: dateStrs[columnIndex],
      hourHeight: 60,
      ghost,
      card,
      moved: false,
      colCount,
      columnsRect,
      dateStrs,
      currentColIdx: columnIndex,
      ghostBaseLeft: columnIndex * colWidth,
      scrollContainer: grid,
      scrollRAF: null,
      source: "allday",
      origScrollTop: grid.scrollTop || 0,
      columnsEl,
    };
    card.addClass("dragging");
  }

  private openScheduleTask(taskId: string): void {
    this.detailView.clearHistory();
    this.plugin.settings.selectedTaskId = taskId;
    void this.plugin.saveSettings();
    this.detailView.open(taskId);
    const layout = this.containerEl.querySelector(".todo-layout");
    if (layout) layout.addClass("todo-layout-detail-open");
  }

  private getContrastColor(hex: string): string {
    if (!hex || hex.length < 7) return "#ffffff";
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.5 ? "#1a1a1a" : "#ffffff";
  }

  private isAllDayTask(task: Task): boolean {
    return isAllDayTaskRule(task);
  }

  private isVisibleInSchedule(task: Task, view: "day" | "week" | "month"): boolean {
    return isVisibleInScheduleRule(task, view, this.plugin.settings);
  }

  private renderTimeLine(container: HTMLElement): void {
    const HOUR_HEIGHT = 60;
    const line = container.createDiv({ cls: "todo-time-line" });
    line.createDiv({ cls: "todo-time-line-dot" });
    const update = () => {
      const now = new Date();
      const min = now.getHours() * 60 + now.getMinutes();
      line.style.top = ((min / 60) * HOUR_HEIGHT) + "px";
    };
    update();
    this.timeLineTimer = window.setInterval(update, 60000);
  }

  // T-703: Utility — pixel to snapped minute (15min grid)
  private snapMinute(px: number, hourHeight: number): number {
    const raw = (px / hourHeight) * 60;
    return Math.round(raw / 15) * 15;
  }

  // T-703: Utility — dateStr + minuteOfDay → ISO string
  private minuteToIso(dateStr: string, minute: number): string {
    const capped = Math.min(minute, 1439);
    const h = Math.floor(capped / 60);
    const m = capped % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return dateStr + "T" + pad(h) + ":" + pad(m) + ":00";
  }

  // T-703: Handle drag move

  private async promptPlanCreate(kind: PlanKind, periodKey: string, parentId?: string, tags?: string[]): Promise<void> {
    const title = await new PromptModal(this.app, "输入任务标题").openAndGetValue();
    if (!title?.trim()) return;
    await this.plugin.taskService.create({
      title: title.trim(),
      planKind: kind,
      planPeriodKey: periodKey,
      ...(parentId ? { parentId } : {}),
      ...(tags ? { tags } : {}),
    });
    if (this.activePlanKind === "year" || this.activePlanKind === "month") {
      await this.renderGoalDashboard(this.activePlanKind, !!parentId);
    } else if (this.activePlanKind) {
      await this.renderPlanView(this.activePlanKind);
    }
  }

  private closeDetailIfTarget(taskId: string): void {
    if (this.detailView?.isActive() && this.detailView.getTaskId() === taskId) {
      this.closeDetail();
    }
  }

  private highlightSelectedTask(taskId: string): void {
    this.taskListEl?.querySelectorAll(".todo-task-item, .todo-life-card").forEach((el) => {
      el.toggleClass("todo-task-selected", (el as HTMLElement).dataset.taskId === taskId);
    });
  }

  private refreshDetailIfActive(taskId: string): void {
    if (this.detailView?.isActive() && this.detailView.getTaskId() === taskId) {
      const task = this.plugin.taskService.getAll().find((t) => t.id === taskId);
      if (task) this.detailView.refresh(task);
    }
  }

  private closeDetail(): void {
    this.plugin.settings.selectedTaskId = null;
    void this.plugin.saveSettings();
    this.aiView?.close();
    this.detailView?.close();
    const layout = this.containerEl.querySelector(".todo-layout");
    if (layout) layout.removeClass("todo-layout-detail-open");
  }

  private async scheduleWeekPlan(task: Task, date: string): Promise<void> {
    const shift = (value: string | null, fallback: string): string => {
      if (!value || !value.includes("T")) return date + fallback;
      return date + value.substring(value.indexOf("T"));
    };
    await this.plugin.taskService.update(task.id, {
      startDate: shift(task.startDate, "T07:00:00"),
      dueDate: shift(task.dueDate, "T23:30:00"),
    });
    new Notice(t("周计划已安排"));
  }

  private async splitWeekPlan(task: Task, currentView: "myday" | "all" | "inbox" | "trash" | "list" | "plan" | "schedule" | "review"): Promise<void> {
    const value = await new PromptModal(this.app, "请输入拆分天数（1-7）").openAndGetValue();
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 7) return;
    const base = task.startDate ? extractLocalDate(task.startDate) : localTodayStr();
    const baseDate = new Date(base + "T00:00:00");
    for (let i = 0; i < count; i++) {
      const day = new Date(baseDate);
      day.setDate(day.getDate() + i);
      const date = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
      const title = count === 1 ? task.title : `${task.title} · 第${i + 1}/${count}天`;
      await this.plugin.taskService.create({
        title,
        note: task.note,
        listId: task.listId,
        tags: [...task.tags],
        isImportant: task.isImportant,
        parentId: task.id,
        startDate: date + "T07:00:00",
        dueDate: date + "T23:30:00",
        myDayGroup: "allday",
      });
    }
    new Notice(t("已拆分为日任务"));
    await this.renderTasks(currentView);
  }

  private showTaskContextMenu(ev: MouseEvent, task: Task, currentView: "myday" | "all" | "inbox" | "trash" | "list" | "plan" | "schedule" | "review"): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle(task.isCompleted ? "标记为未完成" : "标记为已完成")
        .setIcon(task.isCompleted ? "circle" : "check-circle")
        .onClick(async () => {
          if (task.isCompleted) {
            await this.plugin.taskService.uncomplete(task.id);
          } else {
            await this.plugin.taskService.complete(task.id);
          }
          await this.renderTasks(currentView);
        }),
    );

    menu.addItem((item) =>
      item
        .setTitle(task.isImportant ? "取消重要" : "标记为重要")
        .setIcon(task.isImportant ? "star" : "star")
        .onClick(async () => {
          await this.plugin.taskService.update(task.id, { isImportant: !task.isImportant });
          await this.renderTasks(currentView);
        }),
    );

    menu.addSeparator();
    if (task.status === "active") {
      menu.addItem((item) => item.setTitle(t("搁置任务")).setIcon("pause-circle").onClick(async () => {
        await this.plugin.taskService.update(task.id, { status: "shelved" });
        await this.renderTasks(currentView);
      }));
      menu.addItem((item) => item.setTitle(t("放弃任务")).setIcon("x-circle").onClick(async () => {
        await this.plugin.taskService.update(task.id, { status: "abandoned" });
        await this.renderTasks(currentView);
      }));
    } else if (task.status === "shelved") {
      menu.addItem((item) => item.setTitle(t("恢复为进行中")).setIcon("play-circle").onClick(async () => {
        await this.plugin.taskService.update(task.id, { status: "active" });
        await this.renderTasks(currentView);
      }));
      menu.addItem((item) => item.setTitle(t("放弃任务")).setIcon("x-circle").onClick(async () => {
        await this.plugin.taskService.update(task.id, { status: "abandoned" });
        await this.renderTasks(currentView);
      }));
    } else if (task.status === "abandoned") {
      menu.addItem((item) => item.setTitle(t("恢复为进行中")).setIcon("play-circle").onClick(async () => {
        await this.plugin.taskService.update(task.id, { status: "active" });
        await this.renderTasks(currentView);
      }));
    }

    if (currentView !== 'plan') {
      const isMyDayTask = this.getTaskMyDayDate(task) !== null;
      menu.addItem((item) =>
        item
          .setTitle(isMyDayTask ? "从“我的一天”移除" : "添加到“我的一天”")
          .setIcon(isMyDayTask ? "calendar-minus" : "calendar-plus")
          .onClick(async () => {
            const todayStr = localTodayStr();
            if (isMyDayTask) {
              await this.plugin.taskService.update(task.id, { startDate: null, dueDate: null });
            } else {
              const shiftToToday = (value: string | null, fallback: string): string => {
                if (!value || !value.includes("T")) return todayStr + fallback;
                return todayStr + value.substring(value.indexOf("T"));
              };
              await this.plugin.taskService.update(task.id, {
                startDate: shiftToToday(task.startDate, "T07:00:00"),
                dueDate: shiftToToday(task.dueDate, "T23:30:00"),
              });
            }
            await this.renderTasks(currentView);
          }),
      );
    }

    // Postpone options
    if (!task.isCompleted && task.dueDate) {
      menu.addSeparator();
      const currentDue = task.dueDate;
      const dueDateStr = extractLocalDate(currentDue);
      const baseDate = new Date(dueDateStr + "T00:00:00");
      const pad = (n: number) => String(n).padStart(2, "0");
      const formatNewDate = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const dueTimeSuffix = currentDue.substring(10);
      const hasStart = !!task.startDate;
      const startBase = hasStart ? new Date(extractLocalDate(task.startDate!) + "T00:00:00") : null;
      const startTimeSuffix = hasStart ? task.startDate!.substring(10) : "";
      const shiftDays = (base: Date, days: number) => { const d = new Date(base); d.setDate(base.getDate() + days); return d; };
      menu.addItem((item) =>
        item.setTitle("延期到明天").setIcon("calendar").onClick(async () => {
          const newDueDate = formatNewDate(shiftDays(baseDate, 1)) + dueTimeSuffix;
          const changes: Partial<Task> = { dueDate: newDueDate };
          if (hasStart && startBase) { changes.startDate = formatNewDate(shiftDays(startBase, 1)) + startTimeSuffix; }
          await this.plugin.taskService.update(task.id, changes);
          await this.renderTasks(currentView);
        }),
      );
      menu.addItem((item) =>
        item.setTitle("延期到后天").setIcon("calendar").onClick(async () => {
          const newDueDate = formatNewDate(shiftDays(baseDate, 2)) + dueTimeSuffix;
          const changes: Partial<Task> = { dueDate: newDueDate };
          if (hasStart && startBase) { changes.startDate = formatNewDate(shiftDays(startBase, 2)) + startTimeSuffix; }
          await this.plugin.taskService.update(task.id, changes);
          await this.renderTasks(currentView);
        }),
      );
    }


    // Move to My Day group
    if (currentView === "myday" && this.getTaskMyDayDate(task)) {
      menu.addSeparator();
      MYDAY_GROUPS.forEach(({ key, label }) => {
        menu.addItem((item) =>
          item
            .setTitle(`移动至 ${label}`)
            .setChecked((task.myDayGroup || "allday") === key)
            .onClick(async () => {
              // Update dates based on group
              const targetDate = this.myDayViewDate || this.getTaskMyDayDate(task) || localTodayStr();
              const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
              const today = new Date(targetYear, targetMonth - 1, targetDay);
              const groupTimes: Record<MyDayGroup, { startH: number; startM: number; endH: number; endM: number }> = {
                allday: { startH: 7, startM: 0, endH: 23, endM: 30 },
                morning: { startH: 7, startM: 0, endH: 11, endM: 59 },
                noon: { startH: 12, startM: 0, endH: 13, endM: 59 },
                afternoon: { startH: 14, startM: 0, endH: 17, endM: 59 },
                evening: { startH: 18, startM: 0, endH: 23, endM: 30 },
              };
              const t = groupTimes[key];
              const startDate = new Date(today);
              startDate.setHours(t.startH, t.startM);
              const dueDate = new Date(today);
              dueDate.setHours(t.endH, t.endM);
              await this.plugin.taskService.update(task.id, {
                myDayGroup: key,
                startDate: startDate.toISOString(),
                dueDate: dueDate.toISOString(),
              });
              await this.renderTasks(currentView);
            }),
        );
      });
    }

    if (task.planKind === "week") {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("安排到今天")).setIcon("sun").onClick(async () => {
        await this.scheduleWeekPlan(task, localTodayStr());
        await this.renderTasks(currentView);
      }));
      menu.addItem((item) => item.setTitle(t("安排到指定日期")).setIcon("calendar-days").onClick(async () => {
        const selected = await new DateOnlyModal(this.app, this.getTaskMyDayDate(task) || localTodayStr()).openAndGetValue();
        if (!selected) return;
        await this.scheduleWeekPlan(task, selected);
        await this.renderTasks(currentView);
      }));
      menu.addItem((item) => item.setTitle(t("拆分为日任务")).setIcon("split").onClick(() => this.splitWeekPlan(task, currentView)));
    }

    if (!task.planKind) {
      menu.addItem((item) =>
        item
          .setTitle(t("添加到我的计划"))
          .setIcon("calendar-plus")
          .onClick(() => {
            if (this.isMobile()) this.showAddToPlanMenu(task, currentView);
          }),
      );
    }

    // Plan goals can be moved between quarters or weeks. Keep the goal's
    // other fields intact while re-linking it to the matching parent goal.
    if (task.planKind === "quarter" || task.planKind === "week") {
      menu.addItem((item) =>
        item
          .setTitle(t(task.planKind === "quarter" ? "移动到季度..." : "移动到周..."))
          .setIcon("calendar-range")
          .onClick(() => this.showMovePlanMenu(task, currentView)),
      );
    }

    const lists = this.plugin.listService.getActive().filter((l) => l.id !== task.listId);
    if (lists.length) {
      menu.addItem((item) =>
        item
          .setTitle(t("移动到列表..."))
          .setIcon("folder")
          .onClick(() => {
            if (this.isMobile()) this.showMoveToListMenu(task, currentView, lists);
          }),
      );
    }

    menu.addSeparator();

    // 重复系列删除
    if (task.recurrenceGroupId && task.recurrence) {
      const groupInstances = this.plugin.taskService.getGroupInstances(task.recurrenceGroupId);
      const uncompletedCount = groupInstances.filter(t => !t.isCompleted).length;
      menu.addItem((item) =>
        item
          .setTitle("删除整个系列")
          .setIcon("trash")
          .onClick(async () => {
            const confirmed = await new ConfirmModal(this.app, "将删除 " + uncompletedCount + " 个未完成实例，已完成的保留。确定继续？").openAndConfirm();
            if (!confirmed) return;
            await this.plugin.taskService.deleteSeries(task.recurrenceGroupId!);
            this.closeDetailIfTarget(task.id);
            await this.renderLists();
            await this.renderTasks(currentView);
          }),
      );
    }

    menu.addItem((item) =>
      item
        .setTitle("删除任务")
        .setIcon("trash")
        .onClick(async () => {
          const childCount = this.plugin.taskService.countChildren(task.id);
          if (childCount > 0) {
            const confirmed = await new ConfirmModal(this.app, "\u4efb\u52a1\u300c" + task.title + "\u300d\u6709 " + childCount + " \u4e2a\u5b50\u4efb\u52a1\uff0c\u5220\u9664\u540e\u5b50\u4efb\u52a1\u4e5f\u5c06\u88ab\u5220\u9664\u3002\u786e\u5b9a\u7ee7\u7eed\uff1f").openAndConfirm();
            if (!confirmed) return;
          }
          await this.plugin.taskService.delete(task.id);
          this.closeDetailIfTarget(task.id);
          await this.renderLists();
          await this.renderTasks(currentView);
        }),
    );

    menu.showAtMouseEvent(ev);
    if (!this.isMobile()) {
      this.attachDesktopPlanSubmenu(task, currentView);
      this.attachDesktopListSubmenu(task, currentView, lists);
      this.attachDesktopPlanMoveSubmenu(task, currentView);
    }
  }

  private getPlanMoveOptions(task: Task): string[] {
    if (task.planKind === "quarter") {
      const years = new Set<string>();
      for (const item of this.plugin.taskService.getAll()) {
        if (!item.isDeleted && item.planKind === "year" && item.planPeriodKey) years.add(item.planPeriodKey);
      }
      years.add(currentPeriodKey("year"));
      return Array.from(years).sort().flatMap((year) => getSubPeriodKeysForParent("year", year));
    }
    if (task.planKind === "week") {
      const parent = this.plugin.taskService.getParentOf(task.id);
      const monthKey = parent?.planKind === "month" && parent.planPeriodKey
        ? parent.planPeriodKey
        : getParentPeriodKey("week", task.planPeriodKey ?? "");
      return monthKey ? getSubPeriodKeysForParent("month", monthKey) : [];
    }
    return [];
  }

  private async movePlanTask(task: Task, targetKey: string, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): Promise<void> {
    if (!task.planKind || (task.planKind !== "quarter" && task.planKind !== "week")) return;
    const changes: Partial<Task> = { planPeriodKey: targetKey };
    if (task.planKind === "quarter") {
      const parentKey = getParentPeriodKey("quarter", targetKey);
      const parent = parentKey ? this.plugin.taskService.getByPlanKindAndPeriod("year", parentKey)[0] : undefined;
      changes.parentId = parent?.id;
    }
    await this.plugin.taskService.update(task.id, changes);
    await this.renderLists();
    if (currentView === "plan") {
      if (this.activePlanKind === "year" || this.activePlanKind === "month") {
        await this.renderGoalDashboard(this.activePlanKind);
      } else {
        await this.renderPlanView(this.activePlanKind || task.planKind);
      }
    } else {
      await this.renderTasks(currentView);
    }
  }

  private showMovePlanMenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): void {
    const submenu = new Menu();
    submenu.addItem((item) => item
      .setTitle(t("返回"))
      .setIcon("arrow-left")
      .onClick(() => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: Math.round(window.innerWidth / 2),
          clientY: Math.round(window.innerHeight / 2),
        });
        this.showTaskContextMenu(event, task, currentView);
      }));
    submenu.addSeparator();
    for (const key of this.getPlanMoveOptions(task)) {
      submenu.addItem((item) => item
        .setTitle(task.planKind === "quarter" ? this.localizedSubGroupLabel("quarter", key) : this.localizedSubGroupLabel("week", key))
        .setIcon(task.planKind === "quarter" ? "calendar" : "calendar-days")
        .setChecked(task.planPeriodKey === key)
        .onClick(() => { void this.movePlanTask(task, key, currentView); }));
    }
    submenu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  private attachDesktopPlanMoveSubmenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): void {
    if (task.planKind !== "quarter" && task.planKind !== "week") return;
    window.setTimeout(() => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".menu"));
      const moveLabel = t(task.planKind === "quarter" ? "移动到季度..." : "移动到周...");
      const menu = menus.reverse().find((candidate) => candidate.offsetParent && Array.from(candidate.querySelectorAll<HTMLElement>(".menu-item")).some((item) => item.textContent?.includes(moveLabel)));
      if (!menu) return;
      const item = Array.from(menu.querySelectorAll<HTMLElement>(".menu-item")).find((candidate) => candidate.textContent?.includes(moveLabel));
      if (!item) return;

      const submenu = document.body.createDiv({ cls: "todo-list-submenu" });
      submenu.setAttribute("role", "menu");
      let hideTimer: number | null = null;
      const hide = () => {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (menu.isConnected) submenu.classList.remove("is-visible");
          else submenu.remove();
        }, 120);
      };
      const keep = () => { if (hideTimer !== null) window.clearTimeout(hideTimer); };
      const show = () => {
        keep();
        if (!submenu.isConnected) document.body.appendChild(submenu);
        const rect = item.getBoundingClientRect();
        submenu.style.left = `${Math.round(rect.right + 4)}px`;
        submenu.style.top = `${Math.round(Math.min(rect.top, window.innerHeight - submenu.offsetHeight - 8))}px`;
        submenu.classList.add("is-visible");
      };
      item.addEventListener("mouseenter", show);
      item.addEventListener("mouseleave", hide);
      submenu.addEventListener("mouseenter", keep);
      submenu.addEventListener("mouseleave", hide);

      for (const key of this.getPlanMoveOptions(task)) {
        const button = submenu.createDiv({ cls: "todo-list-submenu-item" });
        const icon = button.createDiv({ cls: "todo-list-submenu-item-icon" });
        setIcon(icon, task.planKind === "quarter" ? "calendar" : "calendar-days");
        button.createDiv({ cls: "todo-list-submenu-item-label", text: task.planKind === "quarter" ? this.localizedSubGroupLabel("quarter", key) : this.localizedSubGroupLabel("week", key) });
        button.addEventListener("click", () => { runAsyncAction((async () => {
          await this.movePlanTask(task, key, currentView);
          submenu.remove();
          menu.remove();
        })(), "TodoView interaction"); });
      }
    }, 0);
  }

  private attachDesktopListSubmenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review", lists: Array<{ id: string; name: string; isDefault: boolean; groupId: string | null; icon: string }>): void {
    window.setTimeout(() => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".menu"));
      const menu = menus.reverse().find((candidate) => candidate.offsetParent && Array.from(candidate.querySelectorAll<HTMLElement>(".menu-item")).some((item) => item.textContent?.includes(t("移动到列表..."))));
      if (!menu) return;
      const item = Array.from(menu.querySelectorAll<HTMLElement>(".menu-item")).find((candidate) => candidate.textContent?.includes(t("移动到列表...")));
      if (!item) return;

      const submenu = document.body.createDiv({ cls: "todo-list-submenu" });
      submenu.setAttribute("role", "menu");
      let hideTimer: number | null = null;
      const hide = () => {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          // Keep the submenu mounted while the parent menu is open so it can
          // be reopened on a second hover. Clean it up after the parent closes.
          if (menu.isConnected) submenu.classList.remove("is-visible");
          else submenu.remove();
        }, 120);
      };
      const keep = () => { if (hideTimer !== null) window.clearTimeout(hideTimer); };
      const show = () => {
        keep();
        if (!submenu.isConnected) document.body.appendChild(submenu);
        const rect = item.getBoundingClientRect();
        submenu.style.left = `${Math.round(rect.right + 4)}px`;
        submenu.style.top = `${Math.round(Math.min(rect.top, window.innerHeight - submenu.offsetHeight - 8))}px`;
        submenu.classList.add("is-visible");
      };
      item.addEventListener("mouseenter", show);
      item.addEventListener("mouseleave", hide);
      submenu.addEventListener("mouseenter", keep);
      submenu.addEventListener("mouseleave", hide);

      const addList = (list: { id: string; name: string; isDefault: boolean; icon: string }): void => {
        const button = submenu.createDiv({ cls: "todo-list-submenu-item" });
        const icon = button.createDiv({ cls: "todo-list-submenu-item-icon" });
        setIcon(icon, list.icon || "list");
        button.createDiv({ cls: "todo-list-submenu-item-label", text: list.isDefault ? "移动到任务" : list.name });
        button.addEventListener("click", () => { runAsyncAction((async () => {
          await this.plugin.taskService.update(task.id, { listId: list.id });
          submenu.remove();
          menu.remove();
          await this.renderLists();
          await this.renderTasks(currentView);
        })(), "TodoView interaction"); });
      };
      const groups = this.plugin.groupService.getAll();
      const grouped = new Map<string | null, typeof lists>();
      for (const list of lists) {
        const key = list.isDefault ? "__default__" : (list.groupId || null);
        grouped.set(key, [...(grouped.get(key) || []), list]);
      }
      const addLabel = (label: string): void => {
        submenu.createDiv({ cls: "todo-list-submenu-label", text: label });
      };
      const addGroup = (items: typeof lists): void => items.sort((a, b) => a.name.localeCompare(b.name)).forEach(addList);
      const defaults = grouped.get("__default__") || [];
      addGroup(defaults);
      for (const group of groups.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
        const items = grouped.get(group.id) || [];
        if (!items.length) continue;
        addLabel(group.name);
        addGroup(items);
      }
      const ungrouped = grouped.get(null) || [];
      if (ungrouped.length) { addLabel(t("未分组")); addGroup(ungrouped); }
    }, 0);
  }

  private getPlanTargetOptions(): Array<{ kind: PlanKind; label: string; icon: string }> {
    return [
      { kind: "week", label: t("添加到本周计划"), icon: "calendar-days" },
      { kind: "month", label: t("添加到本月计划"), icon: "timer" },
      { kind: "quarter", label: t("添加到本季度计划"), icon: "calendar" },
      { kind: "year", label: t("添加到本年度计划"), icon: "calendar-check" },
    ];
  }

  private async addTaskToPlan(task: Task, kind: PlanKind, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): Promise<void> {
    await this.plugin.taskService.update(task.id, {
      planKind: kind,
      planPeriodKey: currentPeriodKey(kind),
    });
    await this.renderLists();
    await this.renderTasks(currentView);
  }

  private showAddToPlanMenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): void {
    const submenu = new Menu();
    submenu.addItem((item) => item
      .setTitle(t("返回"))
      .setIcon("arrow-left")
      .onClick(() => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: Math.round(window.innerWidth / 2),
          clientY: Math.round(window.innerHeight / 2),
        });
        this.showTaskContextMenu(event, task, currentView);
      }));
    submenu.addSeparator();
    for (const option of this.getPlanTargetOptions()) {
      submenu.addItem((item) => item
        .setTitle(option.label)
        .setIcon(option.icon)
        .onClick(() => { void this.addTaskToPlan(task, option.kind, currentView); }));
    }
    submenu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  private attachDesktopPlanSubmenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review"): void {
    window.setTimeout(() => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>(".menu"));
      const menu = menus.reverse().find((candidate) => candidate.offsetParent && Array.from(candidate.querySelectorAll<HTMLElement>(".menu-item")).some((item) => item.textContent?.includes(t("添加到我的计划"))));
      if (!menu) return;
      const item = Array.from(menu.querySelectorAll<HTMLElement>(".menu-item")).find((candidate) => candidate.textContent?.includes(t("添加到我的计划")));
      if (!item) return;

      const submenu = document.body.createDiv({ cls: "todo-list-submenu" });
      submenu.setAttribute("role", "menu");
      let hideTimer: number | null = null;
      const hide = () => {
        if (hideTimer !== null) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          if (menu.isConnected) submenu.classList.remove("is-visible");
          else submenu.remove();
        }, 120);
      };
      const keep = () => { if (hideTimer !== null) window.clearTimeout(hideTimer); };
      const show = () => {
        keep();
        if (!submenu.isConnected) document.body.appendChild(submenu);
        const rect = item.getBoundingClientRect();
        submenu.style.left = `${Math.round(rect.right + 4)}px`;
        submenu.style.top = `${Math.round(Math.min(rect.top, window.innerHeight - submenu.offsetHeight - 8))}px`;
        submenu.classList.add("is-visible");
      };
      item.addEventListener("mouseenter", show);
      item.addEventListener("mouseleave", hide);
      submenu.addEventListener("mouseenter", keep);
      submenu.addEventListener("mouseleave", hide);

      for (const option of this.getPlanTargetOptions()) {
        const button = submenu.createDiv({ cls: "todo-list-submenu-item" });
        const icon = button.createDiv({ cls: "todo-list-submenu-item-icon" });
        setIcon(icon, option.icon);
        button.createDiv({ cls: "todo-list-submenu-item-label", text: option.label });
        button.addEventListener("click", () => { runAsyncAction((async () => {
          await this.addTaskToPlan(task, option.kind, currentView);
          submenu.remove();
          menu.remove();
        })(), "TodoView interaction"); });
      }
    }, 0);
  }

  private showMoveToListMenu(task: Task, currentView: ViewNav | "list" | "trash" | "schedule" | "review", lists: Array<{ id: string; name: string; isDefault: boolean; groupId: string | null; icon: string }>): void {
    const submenu = new Menu();
    const groups = this.plugin.groupService.getAll();

    // The first-level task menu closes when an item is selected on mobile.
    // Re-open it explicitly so users can return without dismissing the action flow.
    submenu.addItem((item) => item
      .setTitle(t("返回"))
      .setIcon("arrow-left")
      .onClick(() => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: Math.round(window.innerWidth / 2),
          clientY: Math.round(window.innerHeight / 2),
        });
        this.showTaskContextMenu(event, task, currentView);
      }));
    submenu.addSeparator();

    const grouped = new Map<string | null, typeof lists>();
    for (const list of lists) {
      const key = list.isDefault ? "__default__" : (list.groupId || null);
      const existing = grouped.get(key) || [];
      existing.push(list);
      grouped.set(key, existing);
    }
    const addListItems = (items: typeof lists): void => {
      for (const list of items.sort((a, b) => a.name.localeCompare(b.name))) {
        submenu.addItem((item) => item
          .setTitle(list.isDefault ? "移动到任务" : list.name)
          .setIcon(list.icon || "list")
          .onClick(async () => {
            await this.plugin.taskService.update(task.id, { listId: list.id });
            await this.renderLists();
            await this.renderTasks(currentView);
          }));
      }
    };
    const defaultLists = grouped.get("__default__") || [];
    if (defaultLists.length) addListItems(defaultLists);
    for (const group of groups.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      const groupLists = grouped.get(group.id) || [];
      if (!groupLists.length) continue;
      if (submenu) submenu.addSeparator();
      submenu.addItem((item) => item.setTitle(group.name).setIsLabel(true));
      addListItems(groupLists);
    }
    const ungrouped = grouped.get(null) || [];
    if (ungrouped.length) {
      if (defaultLists.length || groups.some((group) => (grouped.get(group.id) || []).length)) submenu.addSeparator();
      submenu.addItem((item) => item.setTitle(t("未分组")).setIsLabel(true));
      addListItems(ungrouped);
    }
    submenu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }

  private getReviewTitle(): string {
    return formatReviewTitle(this.reviewState(), this.reviewMode, isEnglish());
  }

  private reviewDateToStr(): string {
    return reviewDateToString(this.reviewState());
  }

  private reviewState(): ReviewDateState {
    return { year: this.reviewYear, month: this.reviewMonth, date: this.reviewDate };
  }

  private renderReviewView(): void {
    const container = this.taskListEl;
    container.empty();
    const wrap = container.createDiv({ cls: "todo-review-container" });
    const stickyHeader = wrap.createDiv({ cls: "todo-review-sticky-header" });

    const header = stickyHeader.createDiv({ cls: "todo-review-header" });
    const nav = header.createDiv({ cls: "todo-review-nav" });
    const prevBtn = nav.createEl("button", { cls: "todo-review-prev", text: "◀" });
    const titleEl = nav.createSpan({ cls: "todo-review-title", text: this.getReviewTitle() });
    const nextBtn = nav.createEl("button", { cls: "todo-review-next", text: "▶" });
    const todayBtn = nav.createEl("button", { cls: "todo-review-today-btn", text: "今天" });

    const updateView = () => {
      titleEl.textContent = this.getReviewTitle();
      this.renderReviewContent(contentEl);
    };

    prevBtn.addEventListener("click", () => {
      const shifted = shiftReviewDate(this.reviewState(), this.reviewMode, -1);
      this.reviewYear = shifted.year;
      this.reviewMonth = shifted.month;
      this.reviewDate = shifted.date;
      updateView();
    });
    nextBtn.addEventListener("click", () => {
      const shifted = shiftReviewDate(this.reviewState(), this.reviewMode, 1);
      this.reviewYear = shifted.year;
      this.reviewMonth = shifted.month;
      this.reviewDate = shifted.date;
      updateView();
    });
    todayBtn.addEventListener("click", () => {
      const now = new Date();
      this.reviewYear = now.getFullYear();
      this.reviewMonth = now.getMonth();
      this.reviewDate = now.getDate();
      updateView();
    });

    const switchEl = header.createDiv({ cls: "todo-review-mode-switch" });
    const modes = ["day", "week", "month", "year"] as const;
    const modeLabels: Record<string, string> = { day: t("日"), week: t("周"), month: t("月"), year: t("年") };
    for (const m of modes) {
      const btn = switchEl.createSpan({
        cls: "todo-review-mode-btn" + (m === this.reviewMode ? " active" : ""),
        text: modeLabels[m],
      });
      btn.addEventListener("click", () => { runAsyncAction((async () => {
        this.reviewMode = m;
        this.plugin.settings.activeReviewMode = m;
        await this.plugin.saveSettings();
        switchEl.querySelectorAll(".todo-review-mode-btn").forEach((el) => el.removeClass("active"));
        btn.addClass("active");
        titleEl.textContent = this.getReviewTitle();
        this.renderReviewContent(contentEl);
      })(), "TodoView interaction"); });
    }

    const contentEl = wrap.createDiv({ cls: "todo-review-content" });
    this.renderReviewContent(contentEl);
  }

  private renderReviewContent(container: HTMLDivElement): void {
    this.reviewRenderer.render(container, this.reviewMode, this.reviewState());
  }


}
