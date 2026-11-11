import { Menu, Notice, setIcon } from "obsidian";
import type { Task, PlanKind } from "../models/Task";
import type { TodoPluginLike } from "./TodoView";
import { PlanGroupRenderer } from "./PlanGroupRenderer";
import { extractLocalDate } from "../utils/recurrence";
import { currentPeriodKey, getParentPeriodKey, getSubPeriodKeysForParent, localTodayStr, subGroupLabel } from "../utils/period";
import { shiftGoalPeriodKey, summarizeGoalPeriod } from "../utils/goal-dashboard";
import { localizedPeriodLabel, localizedSubGroupLabel } from "../utils/plan-labels";
import { isEnglish, localizeDom, systemTagName, t } from "../i18n";

interface GoalDashboardHost {
  getTaskListEl(): HTMLDivElement;
  getQuickContainerEl(): HTMLDivElement;
  getActivePlanKind(): PlanKind | null;
  isMobile(): boolean;
  openTask(taskId: string): Promise<void>;
  promptPlanCreate(kind: PlanKind, periodKey: string, parentId?: string, tags?: string[]): Promise<void>;
  getWeekPlanMoveOptions(goal: Task): string[];
  refreshLists(): Promise<void>;
  confirmQuarterGoal(): Promise<boolean>;
}

export class GoalDashboardRenderer {
  periodKey: string | null = null;
  private expandedGoalIds = new Set<string>();
  private goalRenderToken = 0;
  private goalKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly plugin: TodoPluginLike,
    private readonly planGroupRenderer: PlanGroupRenderer,
    private readonly host: GoalDashboardHost,
  ) {}

  private get taskListEl(): HTMLDivElement { return this.host.getTaskListEl(); }
  private get quickContainerEl(): HTMLDivElement { return this.host.getQuickContainerEl(); }
  private get activePlanKind(): PlanKind | null { return this.host.getActivePlanKind(); }
  private isMobile(): boolean { return this.host.isMobile(); }
  private promptPlanCreate(kind: PlanKind, periodKey: string, parentId?: string, tags?: string[]): Promise<void> {
    return this.host.promptPlanCreate(kind, periodKey, parentId, tags);
  }
  private localizedSubGroupLabel(kind: PlanKind, key: string): string {
    return localizedSubGroupLabel(kind, key, isEnglish());
  }

  dispose(): void {
    this.goalRenderToken++;
    if (this.goalKeyHandler) document.removeEventListener("keydown", this.goalKeyHandler);
    this.goalKeyHandler = null;
  }

  async renderGoalDashboard(kind: "year"|"month", preserveScrollPosition = false): Promise<void> {
    const renderToken = ++this.goalRenderToken;
    const previousScrollTop = preserveScrollPosition
      ? (this.taskListEl.querySelector(".todo-goal-scroll-content") as HTMLElement | null)?.scrollTop ?? 0
      : 0;
    this.taskListEl.removeClass("todo-life-active");
    this.taskListEl.empty();
    this.taskListEl.addClass("todo-goal-active");
    const curNow = currentPeriodKey(kind);
    if (!this.periodKey || (kind === "year" && this.periodKey.length !== 4) || (kind === "month" && this.periodKey.length !== 7)) {
      this.periodKey = curNow;
    }
    const periodKey = this.periodKey;
    const isCurrentRender = () => this.goalRenderToken === renderToken && this.periodKey === periodKey;
    this.quickContainerEl.style.display = this.plugin.settings.goalViewMode === "list" ? "none" : "";
    if (this.goalKeyHandler) { document.removeEventListener("keydown", this.goalKeyHandler); this.goalKeyHandler = null; }

    const stickyHeader = this.taskListEl.createDiv({ cls: "todo-goal-sticky-header" });
    const goalContent = this.taskListEl.createDiv({ cls: "todo-goal-scroll-content" });
    const nav = stickyHeader.createDiv({ cls: "todo-goal-nav" });
    const prevBtn = nav.createEl("button", { cls: "todo-goal-nav-btn", text: "◀" });
    prevBtn.setAttribute("aria-label", "上一周期");
    const labelEl = nav.createSpan({ cls: "todo-goal-nav-label", text: kind === "year" ? periodKey + " 年" : periodKey });
    const nextBtn = nav.createEl("button", { cls: "todo-goal-nav-btn", text: "▶" });
    nextBtn.setAttribute("aria-label", "下一周期");
    const backBtn = nav.createEl("button", { cls: "todo-goal-nav-btn todo-goal-nav-back", text: kind === "year" ? "回到今年" : "回到本月" });
    backBtn.setAttribute("aria-label", "回到当前");

    const updateLabel = () => {
      labelEl.setText(kind === "year" ? (this.periodKey ?? "") + " 年" : (this.periodKey ?? ""));
      localizeDom(nav);
    };
    const shift = (delta: number) => {
      this.periodKey = shiftGoalPeriodKey(kind, this.periodKey!, delta);
      updateLabel();
      this.renderGoalDashboard(kind);
    };

    prevBtn.addEventListener("click", () => shift(-1));
    nextBtn.addEventListener("click", () => shift(1));
    backBtn.addEventListener("click", () => {
      this.periodKey = curNow;
      updateLabel();
      this.renderGoalDashboard(kind);
    });
    this.goalKeyHandler = (e: KeyboardEvent) => {
      if (!(this.plugin.settings.activeViewNav === "plan" && (this.activePlanKind === "year" || this.activePlanKind === "month"))) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); shift(-1); }
      if (e.key === "ArrowRight") { e.preventDefault(); shift(1); }
    };
    document.addEventListener("keydown", this.goalKeyHandler);

    const goalAllTasks = this.plugin.taskService.getAll();
    const periodTasks = goalAllTasks.filter((t) => t.planKind === kind && t.planPeriodKey === periodKey && !t.isDeleted && !t.isRecurrenceTemplate);
    const todayStr = localTodayStr();
    const summary = summarizeGoalPeriod(goalAllTasks, kind, periodKey, todayStr);

    const statsRow = stickyHeader.createDiv({ cls: "todo-goal-stats-row" });
    const addStatCard = (label: string, value: string, icon: string, extraCls?: string) => {
      const card = statsRow.createDiv({ cls: "todo-goal-stat-card" + (extraCls ? " " + extraCls : "") });
      const top = card.createDiv({ cls: "todo-goal-stat-top" });
      const iconEl = top.createSpan({ cls: "todo-goal-stat-icon" });
      setIcon(iconEl, icon);
      top.createSpan({ cls: "todo-goal-stat-value", text: value });
      card.createDiv({ cls: "todo-goal-stat-label", text: label });
    };
    addStatCard("目标数", String(summary.total), "list-checks", "todo-goal-stat-total");
    addStatCard("已完成", String(summary.completed), "check-circle-2", "todo-goal-stat-completed");
    addStatCard("进行中", String(summary.inProgress), "timer", "todo-goal-stat-inprogress");
    addStatCard("已搁置", String(summary.shelved), "pause-circle", "todo-goal-stat-shelved");
    addStatCard("已放弃", String(summary.abandoned), "x-circle", "todo-goal-stat-abandoned");
    addStatCard("逾期", String(summary.overdue), "alert-triangle", summary.overdue > 0 ? "todo-goal-stat-overdue" : "todo-goal-stat-overdue-empty");
    addStatCard("完成率", summary.completionRate + "%", "pie-chart", summary.completionRate >= 100 ? "todo-goal-stat-rate-full" : undefined);
    localizeDom(this.taskListEl);

    let quarterDropZone: HTMLDivElement | null = null;
    let isDraggingQuarterGoal = false;
    if (kind === "month" && this.plugin.settings.goalViewMode !== "list") {
      goalContent.addEventListener("dragover", (ev) => {
        if (!isDraggingQuarterGoal) return;
        const rect = goalContent.getBoundingClientRect();
        const edge = 56;
        let delta = 0;
        if (ev.clientY < rect.top + edge) {
          delta = -Math.ceil(((rect.top + edge - ev.clientY) / edge) * 24);
        } else if (ev.clientY > rect.bottom - edge) {
          delta = Math.ceil(((ev.clientY - (rect.bottom - edge)) / edge) * 24);
        }
        if (delta !== 0) goalContent.scrollTop += delta;
      });
    }
    // Monthly view: show quarterly goals as draggable cards
    if (kind === "month" && this.plugin.settings.goalViewMode !== "list") {
      const quarterKey = getParentPeriodKey("month", periodKey);
      if (quarterKey) {
        const quarterTasks = this.plugin.taskService.getByPlanKindAndPeriod("quarter", quarterKey);
        const qSection = goalContent.createDiv({ cls: "todo-goal-quarter-section" });
        const qLabel = qSection.createDiv({ cls: "todo-goal-quarter-label", text: isEnglish() ? this.localizedSubGroupLabel("quarter", quarterKey) + " Goals" : subGroupLabel("quarter", quarterKey) + " 目标" });
        const qScroll = qSection.createDiv({ cls: "todo-goal-quarter-scroll" });
        for (const qt of quarterTasks) {
          const qCard = qScroll.createDiv({ cls: "todo-goal-quarter-card", attr: { "data-task-id": qt.id, draggable: "true" } });
          qCard.createSpan({ cls: "todo-goal-quarter-card-title", text: qt.title });
          const qChildren = this.plugin.taskService.getChildrenOf(qt.id);
          const qDone = qChildren.filter(c => c.isCompleted).length;
          if (qChildren.length > 0) {
            qCard.createSpan({ cls: "todo-goal-quarter-card-meta", text: qDone + "/" + qChildren.length });
          }
          qCard.addEventListener("dragstart", (ev) => {
            ev.dataTransfer!.setData("text/plain", qt.id);
            isDraggingQuarterGoal = true;
            qCard.addClass("dragging");
            quarterDropZone?.addClass("is-active");
          });
          qCard.addEventListener("dragend", () => {
            isDraggingQuarterGoal = false;
            qCard.removeClass("dragging");
            quarterDropZone?.removeClass("is-active");
          });
        }
        if (quarterTasks.length === 0) {
          qScroll.createDiv({ cls: "todo-goal-quarter-empty", text: t("暂无季度目标") });
        }
      }
    }

    if (kind === "month") {
      quarterDropZone = goalContent.createDiv({ cls: "todo-quarter-goal-drop-zone", text: t("释放以创建同名月度目标") });
      quarterDropZone.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      });
      quarterDropZone.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        quarterDropZone?.removeClass("is-active");
        const dragId = ev.dataTransfer?.getData("text/plain");
        const quarterGoal = this.plugin.taskService.getAll().find((task) => task.id === dragId && task.planKind === "quarter");
        if (!quarterGoal || !isCurrentRender()) return;

        const linkedMonthlyGoal = this.plugin.taskService.getChildrenOf(quarterGoal.id)
          .find((task) => task.planKind === "month" && task.planPeriodKey === periodKey);
        if (linkedMonthlyGoal) {
          new Notice(t("该季度目标已关联当前月份目标"));
          return;
        }

        const confirmed = await this.host.confirmQuarterGoal();
        if (!confirmed) return;
        if (!isCurrentRender()) return;

        const currentMonthGoals = this.plugin.taskService.getByPlanKindAndPeriod("month", periodKey);
        const sameTitleGoal = currentMonthGoals.find((task) => task.title.trim().toLocaleLowerCase() === quarterGoal.title.trim().toLocaleLowerCase());
        if (sameTitleGoal) {
          await this.plugin.taskService.update(sameTitleGoal.id, { parentId: quarterGoal.id });
        } else {
          await this.plugin.taskService.create({
            title: quarterGoal.title,
            planKind: "month",
            planPeriodKey: periodKey,
            parentId: quarterGoal.id,
            tags: [...quarterGoal.tags],
            isImportant: quarterGoal.isImportant,
          });
        }
        await this.renderGoalDashboard("month");
      });
    }


    const modeSwitch = nav.createDiv({ cls: "todo-goal-mode-switch" });
    const cardModeBtn = modeSwitch.createSpan({ cls: "todo-goal-mode-btn" + (this.plugin.settings.goalViewMode !== "list" ? " active" : ""), text: t("卡片") });
    const listModeBtn = modeSwitch.createSpan({ cls: "todo-goal-mode-btn" + (this.plugin.settings.goalViewMode === "list" ? " active" : ""), text: t("列表") });
    cardModeBtn.addEventListener("click", async () => {
      if (this.plugin.settings.goalViewMode !== "card") {
        this.plugin.settings.goalViewMode = "card";
        await this.plugin.saveSettings();
        cardModeBtn.addClass("active"); listModeBtn.removeClass("active");
        await this.renderGoalDashboard(kind);
      }
    });
    listModeBtn.addEventListener("click", async () => {
      if (this.plugin.settings.goalViewMode !== "list") {
        this.plugin.settings.goalViewMode = "list";
        await this.plugin.saveSettings();
        listModeBtn.addClass("active"); cardModeBtn.removeClass("active");
        await this.renderGoalDashboard(kind);
      }
    });

    const goalAllTags = this.plugin.tagService.getAll();
    const sorted = periodTasks.slice().sort((a, b) => (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0));

    if (this.plugin.settings.goalViewMode === "list") {
      const contentEl = goalContent.createDiv({ cls: "todo-goal-list-content" });
      this.planGroupRenderer.renderGoalList(contentEl, kind, periodKey);
    } else {
    const cards = goalContent.createDiv({ cls: "todo-goal-cards" });
    const goalScrollTarget = cards.createDiv({ cls: "todo-goal-scroll-target" });
    goalScrollTarget.style.height = "0px";

    if (sorted.length === 0) {
      const guide = cards.createDiv({ cls: "todo-goal-guide" });
      guide.createDiv({ text: t(kind === "year" ? "暂无年度目标" : "暂无月度目标") });
    }

    const BATCH = 40;
    let goalIdx = 0;
    const renderGoal = (goal: Task) => {
      const children = this.plugin.taskService.getChildrenOf(goal.id);
      const total = children.length;
      const done = children.filter((c) => c.isCompleted).length;
      const rate = total === 0 ? null : done / total;
      const overdue = !goal.isCompleted && !!goal.dueDate && extractLocalDate(goal.dueDate!) < todayStr;
      // Find parent plan based on period hierarchy (month→quarter, quarter→year)
      let parent: Task | undefined;
      // Use explicit parentId first; fall back to period-based lookup
      parent = this.plugin.taskService.getParentOf(goal.id);
      if (!parent && (goal.planKind === "month" || goal.planKind === "quarter")) {
        const parentKey = getParentPeriodKey(goal.planKind, goal.planPeriodKey ?? "");
        if (parentKey) {
          const parentKind: PlanKind = goal.planKind === "month" ? "quarter" : "year";
          parent = this.plugin.taskService.getByPlanKindAndPeriod(parentKind, parentKey)[0];
        }
      }
      const goalTags = (goal.tags || []).map((id) => goalAllTags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);

      const statusClass = goal.status === "shelved" ? " todo-goal-card-shelved" : goal.status === "abandoned" ? " todo-goal-card-abandoned" : "";
      const card = cards.createDiv({ cls: "todo-goal-card" + (overdue ? " todo-goal-card-overdue" : "") + statusClass });
      card.setAttribute("data-goal-id", goal.id);
      card.tabIndex = 0;
      card.setAttribute("role", "button");

      // Drop handler: associate dragged quarterly goal with this monthly goal
      if (kind === "month") {
        card.addEventListener("dragover", (ev) => { ev.preventDefault(); card.addClass("todo-goal-card-drop-hover"); });
        card.addEventListener("dragleave", () => { card.removeClass("todo-goal-card-drop-hover"); });
        card.addEventListener("drop", async (ev) => {
          ev.preventDefault();
          card.removeClass("todo-goal-card-drop-hover");
          const dragId = ev.dataTransfer?.getData("text/plain");
          if (dragId && dragId !== goal.id) {
            await this.plugin.taskService.update(goal.id, { parentId: dragId });
            await this.renderGoalDashboard(kind);
          }
        });
      }

            // row1: checkbox + title + right-aligned parent/tags
      const row1 = card.createDiv({ cls: "todo-goal-card-row" });
      const checkbox = row1.createDiv({ cls: "todo-checkbox" + (goal.isCompleted ? " checked" : ""), text: goal.isCompleted ? "✓" : "" });
      checkbox.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const cur = this.plugin.taskService.getAll().find((t) => t.id === goal.id); if (cur && cur.isCompleted) { await this.plugin.taskService.uncomplete(goal.id); }
        else { await this.plugin.taskService.complete(goal.id); }
        this.refreshGoalCardAndStats(goal.id, kind);
      });
      row1.createSpan({ cls: "todo-goal-card-title", text: goal.title });
      if (!goal.isCompleted && goal.status !== "active") {
        const statusEl = row1.createSpan({ cls: "todo-goal-status-badge" + (goal.status === "shelved" ? " is-shelved" : " is-abandoned") });
        statusEl.setText(goal.status === "shelved" ? t("已搁置") : t("已放弃"));
        const restoreBtn = row1.createEl("button", { cls: "todo-goal-restore-btn" });
        setIcon(restoreBtn, "play-circle");
        restoreBtn.setAttribute("aria-label", t("恢复为进行中"));
        restoreBtn.setAttribute("title", t("恢复为进行中"));
        restoreBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          await this.plugin.taskService.update(goal.id, { status: "active" });
          await this.renderGoalDashboard(kind);
        });
      }
      if (parent || goalTags.length > 0) {
        const right = row1.createDiv({ cls: "todo-goal-card-right" });
        if (parent) {
          const parentLabelMap: Record<string, string> = { life: "人生目标", year: "年度目标", quarter: "季度目标", month: "月度目标" };
          const parentLabel = parentLabelMap[parent.planKind ?? ""] ?? "上级目标";
          right.createSpan({ cls: "todo-goal-card-parent-label", text: parentLabel + "：" + parent.title });
        }
        if (goalTags.length > 0) {
          goalTags.forEach((tag, i) => {
            if (parent && i === 0) {
              right.createSpan({ cls: "todo-goal-card-dot", text: " · " });
            } else if (i > 0) {
              right.createSpan({ cls: "todo-goal-card-dot", text: " · " });
            }
            const tagEl = right.createSpan({ cls: "todo-task-tag-label" });
            const tagIcon = tagEl.createSpan({ cls: "todo-task-tag-icon" });
            setIcon(tagIcon, tag.icon);
            tagEl.createSpan({ text: systemTagName(tag) });
          });
        }
      }

      // row2: progress bar + KR count
      const row2 = card.createDiv({ cls: "todo-goal-card-metrics" });
      if (rate !== null) {
        const pct = Math.round(rate * 100);
        const barWrap = row2.createDiv({ cls: "todo-goal-progress" });
        const barFill = barWrap.createDiv({ cls: "todo-goal-progress-fill" });
        barFill.style.width = pct + "%";
        barWrap.createSpan({ cls: "todo-goal-progress-text", text: pct + "%" });
      }
      row2.createSpan({ cls: "todo-goal-metric-item", text: total === 0 ? "KR 0/0" : "KR " + done + "/" + total });
      if (overdue) row2.createSpan({ cls: "todo-goal-overdue-badge", text: "逾期" });

      // expand button (centered, full width)
      const expandBtn = card.createDiv({ cls: "todo-goal-expand-btn" });
      expandBtn.createSpan({ cls: "todo-goal-expand-text", text: "展开 ▾" });

      // expand body
      const body = card.createDiv({ cls: "todo-goal-card-body todo-goal-card-body-collapsed" });
      let bodyRendered = false;
      const openGoal = () => this.host.openTask(goal.id);
      card.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); void openGoal(); } });
      expandBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const collapsed = body.classList.contains("todo-goal-card-body-collapsed");
        if (collapsed && !bodyRendered) {
          bodyRendered = true;
          const subKind = kind === "year" ? "quarter" : "week";
          const subKeys = getSubPeriodKeysForParent(kind, periodKey);
          const grouped = new Map<string, { task: Task; completed: boolean }[]>();
          for (const sk of subKeys) grouped.set(sk, []);
          for (const c of children) {
            const key = c.planPeriodKey && grouped.has(c.planPeriodKey) ? c.planPeriodKey : null;
            if (key) grouped.get(key)!.push({ task: c, completed: c.isCompleted });
          }
          let hasAny = false;
          const KR_LIMIT = 50;
          let krRendered = 0;
          const renderKRItem = (sk: string, it: { task: Task; completed: boolean }, goalId: string, k: "year" | "month") => {
            const krOverdue = !it.completed && !!it.task.dueDate && extractLocalDate(it.task.dueDate!) < todayStr;
            const row = body.createDiv({ cls: "todo-goal-kr-item" + (it.completed ? " todo-goal-kr-done" : "") + (krOverdue ? " todo-goal-kr-overdue" : "") });
            const krCheck = row.createDiv({ cls: "todo-checkbox" + (it.completed ? " checked" : ""), text: it.completed ? "✓" : "" });
            krCheck.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              if (it.completed) { await this.plugin.taskService.uncomplete(it.task.id); }
              else { await this.plugin.taskService.complete(it.task.id); }
              it.completed = !it.completed;
              krCheck.setText(it.completed ? "✓" : ""); krCheck.toggleClass("checked", it.completed);
              row.toggleClass("todo-goal-kr-done", it.completed);
              this.refreshGoalCardAndStats(goalId, k);
            });
            row.createSpan({ cls: "todo-goal-kr-title", text: it.task.title });
            row.addEventListener("click", async (ev) => {
              ev.stopPropagation();
              await this.host.openTask(it.task.id);
            });
          };
          for (const [sk, items] of grouped) {
            hasAny = true;
            const title = this.localizedSubGroupLabel(subKind, sk);
            const sgHeader = body.createDiv({ cls: "todo-goal-subgroup-title" });
            sgHeader.createSpan({ text: title });
            const addBtn = sgHeader.createSpan({ cls: "todo-goal-subgroup-add", text: " ＋" });
            addBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              if (this.isMobile()) {
                void this.promptPlanCreate(subKind, sk, goal.id, goal.tags ? [...goal.tags] : []);
                return;
              }
              if (sgHeader.dataset.addOpen === "1") return;
              sgHeader.dataset.addOpen = "1";
              const inputWrap = document.createElement("div");
              inputWrap.className = "todo-goal-subgroup-inline-input";
              sgHeader.after(inputWrap);
              const input = inputWrap.createEl("input", { type: "text", placeholder: "输入KR标题..." });
              input.focus();
              let saved = false;
              const save = async () => {
                if (saved || !input.value.trim()) { if (inputWrap.isConnected) inputWrap.remove(); sgHeader.dataset.addOpen = "0"; return; }
                saved = true;
                try {
                  const newTask = await this.plugin.taskService.create({
                    title: input.value.trim(),
                    planKind: subKind,
                    planPeriodKey: sk,
                    parentId: goal.id,
                    tags: goal.tags ? [...goal.tags] : [],
                  });
                  // Re-render the dashboard (preserves expanded state via expandedGoalIds)
                  window.setTimeout(() => { void this.renderGoalDashboard(kind, true); }, 0);
                } catch (e) {
                  console.error("[PlanToDay] Failed to create KR:", e);
                }
              };
              input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); void save(); }
                if (e.key === "Escape") { inputWrap.remove(); sgHeader.dataset.addOpen = "0"; }
              });
              input.addEventListener("blur", () => { void save(); });
            });
            for (const it of items) {
              if (krRendered < KR_LIMIT) { renderKRItem(sk, it, goal.id, kind); krRendered++; }
            }
          }
          const remaining = children.length - krRendered;
          if (remaining > 0) {
            const moreBtn = body.createEl("button", { cls: "todo-goal-kr-more", text: "查看更多KR（" + remaining + "）" });
            moreBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              let left = remaining;
              for (const [sk, items] of grouped) {
                for (const it of items) {
                  if (left <= 0) break;
                  renderKRItem(sk, it, goal.id, kind);
                  left--;
                }
                if (left <= 0) break;
              }
              moreBtn.remove();
            });
          }

        }
        body.classList.toggle("todo-goal-card-body-collapsed", !collapsed);
        if (collapsed) this.expandedGoalIds.add(goal.id); else this.expandedGoalIds.delete(goal.id);
        const et = expandBtn.querySelector(".todo-goal-expand-text") as HTMLElement; if (et) et.setText(collapsed ? "收起 ▴" : "展开 ▾");
      });

      // Auto-expand previously expanded cards
      if (this.expandedGoalIds.has(goal.id)) expandBtn.click();

      card.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const menu = new Menu();

        // Toggle complete
        menu.addItem((item) =>
          item
            .setTitle(goal.isCompleted ? "\u6807\u8BB0\u4E3A\u672A\u5B8C\u6210" : "\u6807\u8BB0\u4E3A\u5DF2\u5B8C\u6210")
            .setIcon(goal.isCompleted ? "circle" : "check-circle")
            .onClick(async () => {
              if (goal.isCompleted) { await this.plugin.taskService.uncomplete(goal.id); }
              else { await this.plugin.taskService.complete(goal.id); }
              this.refreshGoalCardAndStats(goal.id, kind);
            }),
        );



        menu.addSeparator();

        if (goal.planKind === "month" || (goal.planKind === "week" && kind === "month")) {
          menu.addItem((item) =>
            item
              .setTitle(t("移动到周期..."))
              .setIcon("calendar-range")
              .onClick(() => this.showGoalPeriodMoveMenu(goal, kind)),
          );
          menu.addSeparator();
        }

        // Status actions follow the current state.
        if (goal.status === "active") {
          menu.addItem((item) =>
            item
              .setTitle("\u6401\u7F6E\u76EE\u6807")
              .setIcon("pause-circle")
              .onClick(async () => {
                await this.plugin.taskService.update(goal.id, { status: "shelved" });
                await this.renderGoalDashboard(kind);
              }),
          );
          menu.addItem((item) =>
            item
              .setTitle("\u653E\u5F03\u76EE\u6807")
              .setIcon("x-circle")
              .onClick(async () => {
                await this.plugin.taskService.update(goal.id, { status: "abandoned" });
                await this.renderGoalDashboard(kind);
              }),
          );
        } else if (goal.status === "shelved") {
          menu.addItem((item) =>
            item
              .setTitle("\u6062\u590D\u4E3A\u8FDB\u884C\u4E2D")
              .setIcon("play-circle")
              .onClick(async () => {
                await this.plugin.taskService.update(goal.id, { status: "active" });
                await this.renderGoalDashboard(kind);
              }),
          );
          menu.addItem((item) =>
            item
              .setTitle("\u653E\u5F03\u76EE\u6807")
              .setIcon("x-circle")
              .onClick(async () => {
                await this.plugin.taskService.update(goal.id, { status: "abandoned" });
                await this.renderGoalDashboard(kind);
              }),
          );
        } else if (goal.status === "abandoned") {
          menu.addItem((item) =>
            item
              .setTitle("\u6062\u590D\u4E3A\u8FDB\u884C\u4E2D")
              .setIcon("play-circle")
              .onClick(async () => {
                await this.plugin.taskService.update(goal.id, { status: "active" });
                await this.renderGoalDashboard(kind);
              }),
          );
        }

        menu.addSeparator();

        // Delete
        menu.addItem((item) =>
          item
            .setTitle("\u5220\u9664\u76EE\u6807")
            .setIcon("trash")
            .onClick(async () => {
              await this.plugin.taskService.delete(goal.id);
              this.renderGoalDashboard(kind, true);
            }),
        );

        menu.showAtPosition({ x: ev.clientX, y: ev.clientY });
      });
      card.addEventListener("click", () => { void openGoal(); });
    };

    const appendBatch = () => {
      const end = Math.min(sorted.length, goalIdx + BATCH);
      for (; goalIdx < end; goalIdx++) renderGoal(sorted[goalIdx]);
    };
    appendBatch();
    if (goalIdx < sorted.length) {
      const sentinel = cards.createDiv({ cls: "todo-goal-sentinel" });
      const obs = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { appendBatch(); if (goalIdx >= sorted.length) { obs.disconnect(); sentinel.remove(); } }
        }, { root: goalContent });
      obs.observe(sentinel);
    }

    const firstCard = cards.querySelector(".todo-goal-card") as HTMLElement | null;
    const targetEl = firstCard ?? statsRow;
    if (preserveScrollPosition) {
      goalContent.scrollTop = previousScrollTop;
    } else if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    }
  }

  private refreshGoalCardAndStats(goalId: string, kind: "year" | "month"): void {
    const card = this.taskListEl.querySelector(`[data-goal-id="${goalId}"]`) as HTMLElement | null;
    if (!card) return;
    const goal = this.plugin.taskService.getAll().find((t) => t.id === goalId);
    if (!goal) return;

    // update check symbol
    const checkEl = card.querySelector(".todo-checkbox") as HTMLElement | null;
    if (checkEl) { checkEl.setText(goal.isCompleted ? "✓" : ""); checkEl.toggleClass("checked", goal.isCompleted); }

    // update title completed style
    const titleEl = card.querySelector(".todo-goal-card-title") as HTMLElement | null;
    if (titleEl) titleEl.toggleClass("completed", goal.isCompleted);

    // recalculate KR progress
    const children = this.plugin.taskService.getChildrenOf(goalId);
    const total = children.length;
    const done = children.filter((c) => c.isCompleted).length;
    const rate = total === 0 ? null : done / total;

    // update KR label (second metric-item)
    const metricsRow = card.querySelector(".todo-goal-card-metrics");
    if (metricsRow) {
      const items = metricsRow.querySelectorAll(".todo-goal-metric-item");
      for (const el of Array.from(items)) {
        if (el.textContent && el.textContent.startsWith("KR")) {
          (el as HTMLElement).setText(total === 0 ? "KR 0/0" : "KR " + done + "/" + total);
        }
      }
    }

    // update progress bar (create if missing)
    let barFill = card.querySelector(".todo-goal-progress-fill") as HTMLElement | null;
    let barText = card.querySelector(".todo-goal-progress-text") as HTMLElement | null;
    if (rate !== null && !barFill && metricsRow) {
      const barWrap = metricsRow.createDiv({ cls: "todo-goal-progress" });
      barFill = barWrap.createDiv({ cls: "todo-goal-progress-fill" });
      barText = barWrap.createSpan({ cls: "todo-goal-progress-text" });
    }
    if (rate !== null) {
      const pct = Math.round(rate * 100);
      if (barFill) barFill.style.width = pct + "%";
      if (barText) barText.setText(pct + "%");
    }

    // update overdue state
    const todayStr = localTodayStr();
    const overdue = !goal.isCompleted && !!goal.dueDate && extractLocalDate(goal.dueDate!) < todayStr;
    card.toggleClass("todo-goal-card-overdue", overdue);
    let overdueBadge = card.querySelector(".todo-goal-overdue-badge") as HTMLElement | null;
    if (overdue && !overdueBadge) {
      const r2 = card.querySelector(".todo-goal-card-metrics");
      if (r2) r2.createSpan({ cls: "todo-goal-overdue-badge", text: "\u903E\u671F" });
    } else if (!overdue && overdueBadge) {
      overdueBadge.remove();
    }

    // update stats row
    const goalAllTasks = this.plugin.taskService.getAll();
    const summary = summarizeGoalPeriod(goalAllTasks, kind, this.periodKey ?? "", todayStr);

    const statsRow = this.taskListEl.querySelector(".todo-goal-stats-row") as HTMLElement | null;
    if (statsRow) {
      const values = statsRow.querySelectorAll(".todo-goal-stat-value");
      if (values[0]) values[0].setText(String(summary.total));
      if (values[1]) values[1].setText(String(summary.completed));
      if (values[2]) values[2].setText(String(summary.inProgress));
      if (values[3]) {
        values[3].setText(String(summary.shelved));
      }
      if (values[4]) {
        values[4].setText(String(summary.abandoned));
      }
      if (values[5]) {
        values[5].setText(String(summary.overdue));
        const oc = values[5].closest(".todo-goal-stat-card") as HTMLElement | null;
        if (oc) { oc.removeClass("todo-goal-stat-overdue"); oc.removeClass("todo-goal-stat-overdue-empty"); oc.addClass(summary.overdue > 0 ? "todo-goal-stat-overdue" : "todo-goal-stat-overdue-empty"); }
      }
      if (values[6]) {
        values[6].setText(summary.completionRate + "%");
        const rc = values[6].closest(".todo-goal-stat-card") as HTMLElement | null;
        if (rc) { rc.removeClass("todo-goal-stat-rate-full"); if (summary.completionRate >= 100) rc.addClass("todo-goal-stat-rate-full"); }
      }
    }
  }

  private getGoalPeriodMoveOptions(goal: Task): string[] {
    if (goal.planKind === "month") {
      const parent = this.plugin.taskService.getParentOf(goal.id);
      const quarterKey = parent?.planKind === "quarter" && parent.planPeriodKey
        ? parent.planPeriodKey
        : getParentPeriodKey("month", goal.planPeriodKey ?? "");
      if (!quarterKey) return [];
      const [yearPart, quarterPart] = quarterKey.split("-Q");
      const year = Number(yearPart);
      const quarter = Number(quarterPart);
      if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return [];
      return [0, 1, 2].map((offset) => {
        const month = (quarter - 1) * 3 + offset + 1;
        return `${year}-${String(month).padStart(2, "0")}`;
      });
    }
    if (goal.planKind === "week") return this.host.getWeekPlanMoveOptions(goal);
    return [];
  }

  private async moveGoalToPeriod(goal: Task, targetKey: string, dashboardKind: "year" | "month"): Promise<void> {
    if (goal.planKind !== "month" && goal.planKind !== "week") return;
    await this.plugin.taskService.update(goal.id, { planPeriodKey: targetKey });
    await this.host.refreshLists();
    await this.renderGoalDashboard(dashboardKind);
  }

  private showGoalPeriodMoveMenu(goal: Task, dashboardKind: "year" | "month"): void {
    if (goal.planKind !== "month" && goal.planKind !== "week") return;
    const submenu = new Menu();
    for (const key of this.getGoalPeriodMoveOptions(goal)) {
      submenu.addItem((item) => item
        .setTitle(goal.planKind === "month"
          ? localizedPeriodLabel("month", key, isEnglish())
          : this.localizedSubGroupLabel("week", key))
        .setIcon(goal.planKind === "month" ? "calendar-days" : "calendar-range")
        .setChecked(goal.planPeriodKey === key)
        .onClick(() => { void this.moveGoalToPeriod(goal, key, dashboardKind); }));
    }
    submenu.showAtPosition({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) });
  }
}
