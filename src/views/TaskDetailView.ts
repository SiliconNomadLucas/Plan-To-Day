import { App, Menu, Notice, setIcon, TFile, TFolder } from "obsidian";
import type { TodoPluginLike } from "./TodoView";
import type { Task } from "../models/Task";
import type { DomainTag } from "../models/Tag";
import { ResourceSuggestModal } from "../ui/ResourceSuggestModal";
import { ConfirmModal, NoteEditModal, WeekSplitModal } from "../ui/TaskEditModals";
import { AgePickerModal, DatePickerModal, RecurrencePickerModal } from "../ui/TaskDateModals";
import { ParentPickerModal, TagPickerModal } from "../ui/TaskPickerModals";
import { formatRecurrenceDisplay } from "../utils/recurrence";
import { localTodayStr, ageFromDueDate } from "../utils/period";
import { isEnglish, localizeDom, systemTagName, t } from "../i18n";
import { runAsyncAction } from "../utils/async-action";

export interface ScheduleSidebarItem {
  id: string;
  title: string;
  subtitle: string;
  isCompleted: boolean;
  status?: string;
}

export class TaskDetailView {
  private app: App;
  private plugin: TodoPluginLike;
  private root: HTMLElement;
  private taskId: string | null = null;
  private titleInput!: HTMLInputElement;
  private noteInput!: HTMLTextAreaElement;
  private propsEl!: HTMLElement;
  private relatedEl!: HTMLElement;
  private pendingSave: Promise<void> | null = null;
  private onTaskUpdated?: (taskId: string) => void;
  private onClose?: () => void;
  private onNavigateToTask?: (taskId: string) => void;
  private onScheduleItemNavigate?: (taskId: string) => void;
  private onOpen?: () => void;
  private historyStack: { taskId: string; title: string }[] = [];
  private scheduleSummary: { title: string; items: ScheduleSidebarItem[] } | null = null;

  constructor(app: App, plugin: TodoPluginLike, root: HTMLElement, onTaskUpdated?: (taskId: string) => void, onClose?: () => void, onNavigateToTask?: (taskId: string) => void, onOpen?: () => void, onScheduleItemNavigate?: (taskId: string) => void) {
    this.app = app;
    this.plugin = plugin;
    this.root = root;
    this.onTaskUpdated = onTaskUpdated;
    this.onClose = onClose;
    this.onNavigateToTask = onNavigateToTask;
    this.onOpen = onOpen;
    this.onScheduleItemNavigate = onScheduleItemNavigate;
    this.root.addClass("todo-detail-panel");
    this.renderEmpty();
  }

  clearHistory(): void { this.historyStack = []; }

  isActive(): boolean { return this.taskId !== null; }
  getTaskId(): string | null { return this.taskId; }

  open(taskId: string): void {
    this.scheduleSummary = null;
    this.taskId = taskId;
    void this.renderCurrentTask();
    this.onOpen?.();
  }

  close(): void {
    this.taskId = null;
    this.scheduleSummary = null;
    this.renderEmpty();
  }

  setRoot(root: HTMLElement): void {
    if (this.root === root) return;
    this.root = root;
    this.root.addClass("todo-detail-panel");
    if (this.scheduleSummary) {
      this.openScheduleSummary(this.scheduleSummary.title, this.scheduleSummary.items);
    } else if (this.taskId) {
      void this.renderCurrentTask();
    } else {
      this.renderEmpty();
    }
  }

  openEmpty(): void {
    this.taskId = null;
    this.scheduleSummary = null;
    this.historyStack = [];
    this.root.empty();
    this.root.addClass("todo-detail-active");
    const header = this.root.createDiv({ cls: "todo-detail-header" });
    const closeBtn = header.createEl("button", { cls: "todo-detail-close" });
    setIcon(closeBtn, "x");
    closeBtn.setAttribute("aria-label", t("关闭"));
    closeBtn.setAttribute("title", t("关闭"));
    closeBtn.addEventListener("click", () => {
      this.close();
      this.onClose?.();
    });
  }

  openScheduleSummary(title: string, items: ScheduleSidebarItem[]): void {
    this.renderScheduleSummary(title, items, true);
  }

  updateScheduleSummary(title: string, items: ScheduleSidebarItem[]): void {
    if (!this.scheduleSummary) return;
    this.renderScheduleSummary(title, items, false);
  }

  private renderScheduleSummary(title: string, items: ScheduleSidebarItem[], notifyOpen: boolean): void {
    this.scheduleSummary = { title, items };
    this.taskId = null;
    this.historyStack = [];
    this.root.empty();
    this.root.removeClass("todo-ai-detail-panel");
    this.root.addClass("todo-detail-active", "todo-schedule-sidebar");

    const header = this.root.createDiv({ cls: "todo-detail-header" });
    const closeBtn = header.createEl("button", { cls: "todo-detail-close" });
    setIcon(closeBtn, "x");
    closeBtn.setAttribute("aria-label", t("关闭"));
    closeBtn.setAttribute("title", t("关闭"));
    closeBtn.addEventListener("click", () => {
      this.close();
      this.onClose?.();
    });

    this.root.createDiv({ cls: "todo-schedule-sidebar-title", text: title });
    const list = this.root.createDiv({ cls: "todo-schedule-sidebar-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "todo-detail-empty", text: t("暂无任务") });
    } else {
      for (const item of items) {
        const row = list.createDiv({ cls: "todo-schedule-sidebar-item" + (item.isCompleted ? " completed" : "") });
        const mark = row.createSpan({ cls: "todo-schedule-sidebar-item-mark" });
        setIcon(mark, item.isCompleted ? "check-circle-2" : "circle");
        const body = row.createDiv({ cls: "todo-schedule-sidebar-item-body" });
        body.createDiv({ cls: "todo-schedule-sidebar-item-title", text: item.title });
        if (item.subtitle) body.createDiv({ cls: "todo-schedule-sidebar-item-subtitle", text: item.subtitle });
        row.addEventListener("click", () => {
          this.clearHistory();
          this.onScheduleItemNavigate?.(item.id);
        });
      }
    }
    localizeDom(this.root);
    if (notifyOpen) this.onOpen?.();
  }

  refresh(task: Task): void {
    if (task.id !== this.taskId) return;
    this.applyValues(task);
  }

  private renderEmpty(): void {
    this.root.empty();
    this.root.removeClass("todo-detail-active", "todo-ai-detail-panel", "todo-schedule-sidebar");
    const empty = this.root.createDiv({ cls: "todo-detail-empty" });
    empty.createDiv({ cls: "todo-detail-empty-title", text: "选择一个任务查看详情" });
    empty.createDiv({ cls: "todo-detail-empty-desc", text: "点击列表中的任务后，可在此处编辑标题、备注、日期、重复规则等属性。" });
  }

  private async renderCurrentTask(): Promise<void> {
    if (this.pendingSave) await this.pendingSave;
    const task = this.getTask();
    if (!task) { this.renderEmpty(); return; }
    this.root.empty();
    this.root.removeClass("todo-ai-detail-panel", "todo-schedule-sidebar");
    this.root.addClass("todo-detail-active");    // --- Header ---
    const header = this.root.createDiv({ cls: "todo-detail-header" });
    // Back button (only when navigation history exists)
    if (this.historyStack.length > 0) {
      const backBtn = header.createDiv({ cls: "todo-detail-back" });
      const backIcon = backBtn.createSpan({ cls: "todo-detail-back-icon" });
      setIcon(backIcon, "arrow-left");
      const prev = this.historyStack[this.historyStack.length - 1];
      backBtn.createSpan({ cls: "todo-detail-back-title", text: prev.title || "\u8fd4\u56de" });
      backBtn.addEventListener("click", () => {
        const entry = this.historyStack.pop();
        if (entry) this.onNavigateToTask?.(entry.taskId);
      });
    }
    const closeBtn = header.createEl("button", { cls: "todo-detail-close" });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => {
      this.historyStack = [];
      this.plugin.settings.selectedTaskId = null;
      void this.plugin.saveSettings();
      this.close();
      this.onClose?.();
    });

    // --- Title row + star ---
    const titleRow = this.root.createDiv({ cls: "todo-detail-title-row" });
    this.titleInput = titleRow.createEl("input", { cls: "todo-detail-title-input", attr: { type: "text", placeholder: "任务标题" } });
    this.titleInput.value = task.title || "";
    const starBtn = titleRow.createDiv({ cls: "todo-detail-star" + (task.isImportant ? " is-important" : "") });
    setIcon(starBtn, "star");
    starBtn.addEventListener("click", () => void this.toggleImportant(starBtn));
    this.titleInput.addEventListener("blur", () => {
      const next = this.titleInput.value.trim();
      if (!next) { this.titleInput.value = task.title || ""; return; }
      if (next !== task.title) void this.saveChanges({ title: next });
    });
    this.titleInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this.titleInput.blur(); }
    });

    // --- Property rows ---
    const props = this.root.createDiv({ cls: "todo-detail-props" });
    this.propsEl = props;
    this.renderPropertyRows(props, task);

    // --- Note area ---
    const noteSection = this.root.createDiv({ cls: "todo-detail-note-section" });
    const noteLabel = noteSection.createDiv({ cls: "todo-detail-label" });
    setIcon(noteLabel, "pen-line");
    noteLabel.createSpan({ text: " 备注" });
    this.noteInput = noteSection.createEl("textarea", { cls: "todo-detail-textarea", attr: { rows: "2" } });
    this.noteInput.value = task.note || "";
    this.noteInput.addEventListener("focus", (ev) => { runAsyncAction((async () => {
      if (window.innerWidth <= 600) {
        ev.preventDefault();
        this.noteInput.blur();
        const modal = new NoteEditModal(this.app, this.noteInput.value);
        const result = await modal.openAndEdit();
        this.noteInput.value = result;
        if (result !== (task.note || "")) void this.saveChanges({ note: result });
      }
    })(), "TaskDetailView interaction"); });
    this.noteInput.addEventListener("blur", () => {
      const next = this.noteInput.value;
      if (next !== (task.note || "")) void this.saveChanges({ note: next });
    });

    // --- Related resources ---
    this.relatedEl = this.root.createDiv({ cls: "todo-detail-related" });
    this.renderRelatedSection(this.relatedEl, task);
    localizeDom(this.root);
    // --- Bottom bar ---
    const bottomBar = this.root.createDiv({ cls: "todo-detail-bottom" });
    bottomBar.createDiv({ cls: "todo-detail-created", text: this.formatCreatedDate(task.createdAt) });
    // 重复系列删除按钮
    if (task.recurrenceGroupId && task.recurrence) {
      const deleteSeriesBtn = bottomBar.createDiv({ cls: "todo-detail-delete" });
      setIcon(deleteSeriesBtn, "trash");
      deleteSeriesBtn.title = "删除整个系列";
      deleteSeriesBtn.addEventListener("click", () => { runAsyncAction((async () => {
        const confirmed = await new ConfirmModal(this.app, "将删除当前及未来的重复任务，过去记录保留。确定继续？").openAndConfirm();
        if (!confirmed) return;
        await this.plugin.taskService.deleteSeries(task.recurrenceGroupId!);
        new Notice("已删除整个重复系列");
        this.plugin.settings.selectedTaskId = null;
        await this.plugin.saveSettings();
        this.close();
        this.onClose?.();
        this.onTaskUpdated?.(task.id);
      })(), "TaskDetailView interaction"); });
    }
    const deleteBtn = bottomBar.createDiv({ cls: "todo-detail-delete" });
    setIcon(deleteBtn, "trash-2");
    deleteBtn.addEventListener("click", () => void this.deleteTask(task));
  }
  private updateStarState(starBtn: HTMLElement, isImportant: boolean): void {
    starBtn.toggleClass("is-important", isImportant);
    setIcon(starBtn, "star");
  }

  private async toggleImportant(starBtn: HTMLElement): Promise<void> {
    const current = starBtn.hasClass("is-important");
    const next = !current;
    this.updateStarState(starBtn, next);
    await this.saveChanges({ isImportant: next });
  }

  private createPropertyRow(parent: HTMLElement, _task: Task, opts: { icon: string; unsetText: string; isSet: boolean; displayText: string; onClick: () => void; onClear: () => void; }): void {
    const row = parent.createDiv({ cls: "todo-prop-row" });
    const iconEl = row.createDiv({ cls: "todo-prop-icon" });
    setIcon(iconEl, opts.icon);
    const textEl = row.createDiv({ cls: "todo-prop-text" + (opts.isSet ? " is-set" : "") });
    textEl.textContent = opts.isSet ? opts.displayText : opts.unsetText;
    textEl.addEventListener("click", opts.onClick);
    if (opts.isSet) {
      const clearBtn = row.createDiv({ cls: "todo-prop-clear" });
      clearBtn.textContent = "\u00d7";
      clearBtn.title = "移除";
      clearBtn.addEventListener("click", opts.onClear);
    }
  }

  private createTagRow(parent: HTMLElement, task: Task, excludeQuadrant = false): void {
    const allTags = this.plugin.tagService.getAll();
    const selectedIds = task.tags || [];
    const selectedTags = selectedIds.map((id) => allTags.find((t) => t.id === id)).filter(Boolean) as DomainTag[];

    const row = parent.createDiv({ cls: "todo-tag-row" });
    const iconEl = row.createDiv({ cls: "todo-prop-icon" });
    setIcon(iconEl, "tag");

    const contentEl = row.createDiv({ cls: "todo-tag-content" });

    if (selectedTags.length > 0) {
      const chipsEl = contentEl.createDiv({ cls: "todo-tag-chips" });
      for (const tag of selectedTags) {
        const chip = chipsEl.createDiv({ cls: "todo-tag-chip" });

        const chipIcon = chip.createSpan({ cls: "todo-tag-chip-icon" });
        setIcon(chipIcon, tag.icon);
        chip.createSpan({ cls: "todo-tag-chip-name", text: systemTagName(tag) });
        const removeBtn = chip.createSpan({ cls: "todo-tag-chip-remove" });
        removeBtn.textContent = "\u00d7";
        removeBtn.title = "移除";
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const next = selectedIds.filter((id) => id !== tag.id);
          const autoImportant = next.some((id) => { const t = allTags.find((x) => x.id === id); return t && t.sortOrder < 2; });
          void this.saveChanges({ tags: next, isImportant: autoImportant });
        });
      }
    }

    const addBtn = contentEl.createDiv({ cls: "todo-tag-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.createSpan({ text: selectedTags.length > 0 ? "标签" : "添加标签" });
    addBtn.addEventListener("click", () => {
      new TagPickerModal(this.app, this.plugin, selectedIds, (nextIds) => {
        const allT = this.plugin.tagService.getAll();
        const autoImp = nextIds.some((id) => { const t = allT.find((x) => x.id === id); return t && t.sortOrder < 2; });
        void this.saveChanges({ tags: nextIds, isImportant: autoImp });
      }, excludeQuadrant).open();
    });
  }

  private createMyDayRow(parent: HTMLElement, task: Task): void {
    const today = localTodayStr();
    const assignedDate = task.dueDate ? task.dueDate.substring(0, 10) : task.startDate ? task.startDate.substring(0, 10) : null;
    const shiftToDate = (value: string | null, date: string, fallbackTime: string): string => {
      if (!value || !value.includes("T")) return date + fallbackTime;
      return date + value.substring(value.indexOf("T"));
    };
    this.createPropertyRow(parent, task, {
      icon: "sun",
      unsetText: "添加到\u201c我的一天\u201d",
      isSet: assignedDate === today,
      displayText: "\u5df2\u5728\u201c\u6211\u7684\u4e00\u5929\u201d\u4e2d",
      onClick: () => { void this.saveChanges({ startDate: shiftToDate(task.startDate, today, "T07:00:00"), dueDate: shiftToDate(task.dueDate, today, "T23:30:00") }); },
      onClear: () => { void this.saveChanges({ startDate: null, dueDate: null }); },
    });
  }

  private createStatusRow(parent: HTMLElement, task: Task): void {
    const labels: Record<string, string> = {
      active: "进行中",
      shelved: "已搁置",
      abandoned: "已放弃",
    };
    const icons: Record<string, string> = {
      active: "play-circle",
      shelved: "pause-circle",
      abandoned: "x-circle",
    };
    const row = parent.createDiv({ cls: "todo-prop-row" });
    const iconEl = row.createDiv({ cls: "todo-prop-icon" });
    const displayCompleted = task.isCompleted;
    setIcon(iconEl, displayCompleted ? "check-circle-2" : (icons[task.status] || icons.active));
    const textEl = row.createDiv({ cls: "todo-prop-text is-set", text: t(displayCompleted ? "已完成" : (labels[task.status] || labels.active)) });
    textEl.addEventListener("click", (ev) => {
      const menu = new Menu();
      menu.addItem((item) => item
        .setTitle(t("已完成"))
        .setIcon("check-circle-2")
        .setChecked(task.isCompleted)
        .onClick(async () => {
          if (task.isCompleted) {
            await this.plugin.taskService.uncomplete(task.id);
          } else {
            await this.plugin.taskService.complete(task.id);
          }
          this.onTaskUpdated?.(task.id);
          const updated = this.getTask();
          if (updated) this.applyValues(updated);
        }));
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("进行中")).setIcon("play-circle").setChecked(!task.isCompleted && task.status === "active").onClick(() => void this.saveChanges({ status: "active" })));
      menu.addItem((item) => item.setTitle(t("搁置")).setIcon("pause-circle").setChecked(!task.isCompleted && task.status === "shelved").onClick(() => void this.saveChanges({ status: "shelved" })));
      menu.addItem((item) => item.setTitle(t("放弃")).setIcon("x-circle").setChecked(!task.isCompleted && task.status === "abandoned").onClick(() => void this.saveChanges({ status: "abandoned" })));
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    });
  }

  private createDueDateRow(parent: HTMLElement, task: Task): void {
    const hasDue = !!task.dueDate;
    let display = "添加截止时间";
    if (hasDue && task.dueDate) { display = "截止时间：" + this.formatDisplayDate(task.dueDate); }
    this.createPropertyRow(parent, task, {
      icon: "calendar",
      unsetText: "添加截止时间",
      isSet: hasDue,
      displayText: display,
      onClick: () => { new DatePickerModal(this.app, task.dueDate, "end", (date) => { void this.saveChanges({ dueDate: date }); }, undefined, !isEnglish() && this.plugin.settings.showLunarCalendar).open(); },
      onClear: () => { void this.saveChanges({ dueDate: null }); },
    });
  }

  private createAgeRow(parent: HTMLElement, task: Task): void {
    const birthday = this.plugin.settings.birthday;
    const hasDue = !!task.dueDate;
    let display = "\u8bbe\u5b9a\u76ee\u6807\u5e74\u9f84";
    if (hasDue && birthday) {
      const age = ageFromDueDate(birthday, task.dueDate!);
      display = "\u76ee\u6807\u5e74\u9f84\uff1a" + age + " \u5c81";
    }
    this.createPropertyRow(parent, task, {
      icon: "calendar",
      unsetText: "\u8bbe\u5b9a\u76ee\u6807\u5e74\u9f84",
      isSet: hasDue,
      displayText: display,
      onClick: () => {
        new AgePickerModal(this.app, birthday, task.dueDate, (isoDate) => {
          void this.saveChanges({ dueDate: isoDate });
        }).open();
      },
      onClear: () => { void this.saveChanges({ dueDate: null }); },
    });
  }

  private createStartDateRow(parent: HTMLElement, task: Task): void {
    const hasStart = !!task.startDate;
    let display = "添加开始时间";
    if (hasStart && task.startDate) { display = "开始时间：" + this.formatDisplayDate(task.startDate); }
    this.createPropertyRow(parent, task, {
      icon: "calendar-days",
      unsetText: "添加开始时间",
      isSet: hasStart,
      displayText: display,
      onClick: () => { new DatePickerModal(this.app, task.startDate, "start", (date) => { void this.saveChanges({ startDate: date }); }, (startIso, endIso) => { void this.saveChanges({ startDate: startIso, dueDate: endIso }); }, !isEnglish() && this.plugin.settings.showLunarCalendar).open(); },
      onClear: () => { void this.saveChanges({ startDate: null }); },
    });
  }

  private createRecurrenceRow(parent: HTMLElement, task: Task): void {
    const hasRec = !!task.recurrence;
    let display = "设置重复";
    if (hasRec && task.recurrence) { display = isEnglish() ? "Recurring" : "重复：" + formatRecurrenceDisplay(task.recurrence); }
    this.createPropertyRow(parent, task, {
      icon: "repeat",
      unsetText: "设置重复",
      isSet: hasRec,
      displayText: display,
      onClick: () => { new RecurrencePickerModal(this.app, task.recurrence, (rec) => { runAsyncAction((async () => { await this.plugin.taskService.setRecurrence(task.id, rec); this.plugin.settings.selectedTaskId = null; await this.plugin.saveSettings(); this.close(); this.onClose?.(); this.onTaskUpdated?.(task.id); })(), "TaskDetailView interaction"); }).open(); },
      onClear: () => {
        // 取消重复：保留当前任务，仅删除更晚的未完成重复实例
        if (task.recurrenceGroupId && task.recurrence) {
          void this.plugin.taskService.stopRecurrence(task.recurrenceGroupId, task.id).then((deletedCount) => {
            new Notice("已取消重复" + (deletedCount > 0 ? "，删除了 " + deletedCount + " 个未来任务" : ""));
            this.onTaskUpdated?.(task.id);
          });
        } else {
          void this.saveChanges({ recurrence: null });
        }
      },
    });

  }
  private async scheduleWeekPlan(task: Task, date: string): Promise<void> {
    const shift = (value: string | null, fallback: string): string => !value || !value.includes("T") ? date + fallback : date + value.substring(value.indexOf("T"));
    await this.saveChanges({ startDate: shift(task.startDate, "T07:00:00"), dueDate: shift(task.dueDate, "T23:30:00") });
    new Notice(t("周计划已安排"));
  }

  private async splitWeekPlan(task: Task): Promise<void> {
    const value = await new WeekSplitModal(this.app).openAndGetValue();
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 7) return;
    const baseDate = new Date((task.startDate ? task.startDate.substring(0, 10) : localTodayStr()) + "T00:00:00");
    for (let i = 0; i < count; i++) {
      const day = new Date(baseDate); day.setDate(day.getDate() + i);
      const date = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
      await this.plugin.taskService.create({ title: count === 1 ? task.title : `${task.title} · 第${i + 1}/${count}天`, note: task.note, listId: task.listId, tags: [...task.tags], isImportant: task.isImportant, parentId: task.id, startDate: date + "T07:00:00", dueDate: date + "T23:30:00", myDayGroup: "allday" });
    }
    new Notice(t("已拆分为日任务"));
    this.onTaskUpdated?.(task.id);
  }

  private createWeekPlanActionRows(parent: HTMLElement, task: Task): void {
    this.createPropertyRow(parent, task, { icon: "sun", unsetText: "安排到今天", isSet: false, displayText: "安排到今天", onClick: () => { void this.scheduleWeekPlan(task, localTodayStr()); }, onClear: () => undefined });
    this.createPropertyRow(parent, task, { icon: "calendar-days", unsetText: "安排到指定日期", isSet: false, displayText: "安排到指定日期", onClick: () => { new DatePickerModal(this.app, task.startDate, "start", (date) => { if (date) void this.scheduleWeekPlan(task, date.substring(0, 10)); }, undefined, !isEnglish() && this.plugin.settings.showLunarCalendar).open(); }, onClear: () => undefined });
    this.createPropertyRow(parent, task, { icon: "split", unsetText: "拆分为日任务", isSet: false, displayText: "拆分为日任务", onClick: () => { void this.splitWeekPlan(task); }, onClear: () => undefined });
  }

  private applyValues(task: Task): void {
    if (!this.root.hasClass("todo-detail-active")) return;
    this.titleInput.value = task.title || "";
    this.noteInput.value = task.note || "";
    const starBtn = this.root.querySelector<HTMLElement>(".todo-detail-star");
    if (starBtn) this.updateStarState(starBtn, task.isImportant);
    // Refresh property rows
    this.propsEl.empty();
    this.renderPropertyRows(this.propsEl, task);
    this.relatedEl.empty();
    this.renderRelatedSection(this.relatedEl, task);
  }


  private createParentSection(parent: HTMLElement, task: Task): void {
    const ts = this.plugin.taskService;
    const pt = ts.getParentOf(task.id);
    const section = parent.createDiv({ cls: "todo-relation-section" });
    const titleRow = section.createDiv({ cls: "todo-relation-section-title" });
    const parentIcon = titleRow.createSpan({ cls: "todo-relation-icon" });
    setIcon(parentIcon, "arrow-up-from-dot");
    titleRow.createSpan({ cls: "todo-relation-label", text: "父任务" });
    const addBtn = titleRow.createSpan({ cls: "todo-relation-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => {
      const exclude = this.getDescendantIds(task.id);
      exclude.push(task.id);
      new ParentPickerModal(this.app, ts, exclude, (parentId) => {
        void this.saveChanges({ parentId });
      }, "parent", task).open();
    });
    if (pt) {
      const item = section.createDiv({ cls: "todo-relation-item" });
      const itemTitle = item.createSpan({ cls: "todo-relation-item-title", text: pt.title || "未命命" });
      itemTitle.addEventListener("click", () => {
        if (this.taskId) {
          const cur = this.getTask();
          this.historyStack.push({ taskId: this.taskId, title: cur?.title || "" });
          if (this.historyStack.length > 5) this.historyStack.shift();
        }
        this.onNavigateToTask?.(pt.id);
      });
      const removeBtn = item.createSpan({ cls: "todo-relation-item-remove" });
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", () => {
        void this.saveChanges({ parentId: undefined });
      });
    }
  }

  private createChildrenSection(parent: HTMLElement, task: Task): void {
    const ts = this.plugin.taskService;
    const children = ts.getChildrenOf(task.id);
    const section = parent.createDiv({ cls: "todo-relation-section" });
    const titleRow = section.createDiv({ cls: "todo-relation-section-title" });
    const childIcon = titleRow.createSpan({ cls: "todo-relation-icon" });
    setIcon(childIcon, "list-checks");
    titleRow.createSpan({ cls: "todo-relation-label", text: "子任务 (" + children.length + ")" });
    const addBtn = titleRow.createSpan({ cls: "todo-relation-add-btn" });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => {
      const exclude = this.getAncestorIds(task.id);
      exclude.push(task.id);
      new ParentPickerModal(this.app, ts, exclude, (childId) => {
        void ts.update(childId, { parentId: task.id });
        this.onTaskUpdated?.(task.id);
      }, "child", task).open();
    });
    for (const child of children) {
      const item = section.createDiv({ cls: "todo-relation-item" });
      const cb = item.createSpan({ cls: "todo-relation-item-cb" });
      cb.textContent = child.isCompleted ? "✓" : "";
      cb.toggleClass("is-completed", child.isCompleted);
      cb.addEventListener("click", (ev) => { runAsyncAction((async () => {
        ev.stopPropagation();
        if (child.isCompleted) { await ts.uncomplete(child.id); } else { await ts.complete(child.id); }
        this.onTaskUpdated?.(task.id);
      })(), "TaskDetailView interaction"); });
      const itemTitle = item.createSpan({ cls: "todo-relation-item-title" + (child.isCompleted ? " completed" : ""), text: child.title || "未命命" });
      itemTitle.addEventListener("click", () => {
        if (this.taskId) {
          const cur = this.getTask();
          this.historyStack.push({ taskId: this.taskId, title: cur?.title || "" });
          if (this.historyStack.length > 5) this.historyStack.shift();
        }
        this.onNavigateToTask?.(child.id);
      });
      const removeBtn = item.createSpan({ cls: "todo-relation-item-remove" });
      setIcon(removeBtn, "x");
      removeBtn.addEventListener("click", () => { runAsyncAction((async () => {
        await ts.update(child.id, { parentId: undefined });
        this.onTaskUpdated?.(task.id);
      })(), "TaskDetailView interaction"); });
    }
  }
  private getAncestorIds(taskId: string): string[] {
    const parent = this.plugin.taskService.getParentOf(taskId);
    if (!parent) return [];
    return [parent.id, ...this.getAncestorIds(parent.id)];
  }

    private getDescendantIds(taskId: string): string[] {
    const children = this.plugin.taskService.getChildrenOf(taskId);
    let ids: string[] = [];
    for (const c of children) {
      ids.push(c.id);
      ids = ids.concat(this.getDescendantIds(c.id));
    }
    return ids;
  }
  private renderPropertyRows(container: HTMLElement, task: Task): void {
    this.createStatusRow(container, task);
    if (task.planKind === 'life') {
      this.createAgeRow(container, task);
      this.createTagRow(container, task, true);
      this.createChildrenSection(container, task);
    } else if (task.planKind === 'year' || task.planKind === 'quarter' || task.planKind === 'month' || task.planKind === 'week') {
      if (task.planKind === 'week') this.createWeekPlanActionRows(container, task);
      this.createTagRow(container, task);
      this.createParentSection(container, task);
      this.createChildrenSection(container, task);
    } else {
      this.createMyDayRow(container, task);
      this.createStartDateRow(container, task);
      this.createDueDateRow(container, task);
      this.createRecurrenceRow(container, task);
      this.createTagRow(container, task);
      this.createParentSection(container, task);
      this.createChildrenSection(container, task);
    }
  }

  private renderRelatedSection(container: HTMLElement, task: Task): void {
    const directPaths = task.relatedPaths || [];
    const folderPaths = task.relatedFolders || [];

    // Resolve folders to file lists
    const folderContents: { folderPath: string; files: string[] }[] = [];
    const allDisplayItems: { path: string; isFolder: boolean; fromFolder?: string }[] = [];

    for (const fp of directPaths) {
      allDisplayItems.push({ path: fp, isFolder: false });
    }

    for (const folderPath of folderPaths) {
      const abs = this.app.vault.getAbstractFileByPath(folderPath);
      if (abs instanceof TFolder) {
        const files: string[] = [];
        const collect = (folder: TFolder) => {
          for (const child of folder.children) {
            if (child instanceof TFile) {
              files.push(child.path);
            } else if (child instanceof TFolder) {
              collect(child);
            }
          }
        };
        collect(abs);
        folderContents.push({ folderPath, files });
        allDisplayItems.push({ path: folderPath, isFolder: true });
        for (const f of files) {
          allDisplayItems.push({ path: f, isFolder: false, fromFolder: folderPath });
        }
      }
    }

    const totalCount = allDisplayItems.length;
    const titleRow = container.createDiv({ cls: "todo-related-title-row" });
    const titleIcon = titleRow.createDiv({ cls: "todo-prop-icon" });
    setIcon(titleIcon, "link");
    const labelText = totalCount > 0 ? "关联文件 (" + totalCount + ")" : "关联文件";
    titleRow.createSpan({ cls: "todo-related-label", text: labelText });

    if (totalCount > 0) {
      const list = container.createDiv({ cls: "todo-related-list" });
      for (const item of allDisplayItems) {
        const row = list.createDiv({ cls: "todo-related-item" + (item.isFolder ? " is-folder" : " is-file") });
        const itemIcon = row.createSpan({ cls: "todo-related-item-icon" });
        setIcon(itemIcon, item.isFolder ? "folder" : "file-text");
        const pathParts = item.path.split('/');
        const displayName = pathParts.length >= 2 ? pathParts.slice(-2).join('/') : item.path;
        const nameEl = row.createSpan({ cls: "todo-related-item-name", text: displayName });
        nameEl.title = item.path;
        if (!item.isFolder) {
          nameEl.addEventListener("click", () => {
            runAsyncAction(this.app.workspace.openLinkText(item.path, "", true), "open related file");
          });
        }
        const removeBtn = row.createSpan({ cls: "todo-related-item-remove" });
        setIcon(removeBtn, "x");
        removeBtn.addEventListener("click", () => {
          if (item.isFolder) {
            const next = folderPaths.filter((fp) => fp !== item.path);
            void this.saveChanges({ relatedFolders: next });
          } else if (item.fromFolder) {
            const next = folderPaths.filter((fp) => fp !== item.fromFolder);
            void this.saveChanges({ relatedFolders: next });
          } else {
            const next = directPaths.filter((dp) => dp !== item.path);
            void this.saveChanges({ relatedPaths: next });
          }
        });
      }
    }

    const addBtn = container.createDiv({ cls: "todo-related-add" });
    setIcon(addBtn, "plus");
    addBtn.createSpan({ text: " 添加关联" });
    addBtn.addEventListener("click", () => {
      const excludePaths = [...directPaths, ...folderPaths];
      new ResourceSuggestModal(this.app, excludePaths, (result) => {
        if (result.isFolder) {
          const next = [...folderPaths, result.path];
          void this.saveChanges({ relatedFolders: next });
        } else {
          const next = [...directPaths, result.path];
          void this.saveChanges({ relatedPaths: next });
        }
      }).open();
    });
  }

  private async saveChanges(changes: Partial<Task>): Promise<void> {
    const taskId = this.taskId;
    if (!taskId) return;
    const existingTask = this.getTask();
    let syncFutureRecurrence = false;
    let syncFutureRecurrenceProperties = false;
    if (existingTask?.recurrence && existingTask.recurrenceGroupId && !existingTask.isRecurrenceTemplate &&
      (changes.startDate !== undefined || changes.dueDate !== undefined)) {
      const nextStart = changes.startDate !== undefined ? changes.startDate : existingTask.startDate;
      const nextDue = changes.dueDate !== undefined ? changes.dueDate : existingTask.dueDate;
      if (nextStart !== existingTask.startDate || nextDue !== existingTask.dueDate) {
        const choice = await new ConfirmModal(
          this.app,
          "是否将新的时间同步到后续未完成的重复任务？",
          "同步后续任务",
          "仅修改当前任务",
          false,
        ).openAndConfirm();
        if (choice === null) return;
        syncFutureRecurrence = choice;
      }
    }
    if (existingTask?.recurrence && existingTask.recurrenceGroupId && !existingTask.isRecurrenceTemplate) {
      const recurrenceFields: Array<keyof Task> = [
        "title", "note", "listId", "tags", "isImportant", "status",
        "relatedPaths", "relatedFolders", "planKind", "planPeriodKey", "parentId",
      ];
      syncFutureRecurrenceProperties = recurrenceFields.some((field) => changes[field] !== undefined && changes[field] !== existingTask[field]);
    }

    // Auto-derive planPeriodKey for life tasks when dueDate changes
    if (changes.dueDate !== undefined) {
      const task = this.getTask();
      const birthday = this.plugin.settings.birthday;
      if (task && task.planKind === "life" && birthday && changes.dueDate) {
        changes.planPeriodKey = String(ageFromDueDate(birthday, changes.dueDate));
      } else if (task && task.planKind === "life" && !changes.dueDate) {
        changes.planPeriodKey = undefined;
      }
    }

    // Date ordering: ensure dueDate >= startDate
    {
      const task = this.getTask();
      const effStart = changes.startDate !== undefined ? changes.startDate : (task?.startDate ?? null);
      const effEnd = changes.dueDate !== undefined ? changes.dueDate : (task?.dueDate ?? null);
      if (effStart && effEnd) {
        const startMs = new Date(effStart).getTime();
        const endMs = new Date(effEnd).getTime();
        if (!isNaN(startMs) && !isNaN(endMs) && endMs < startMs) {
          changes.startDate = effEnd;
          changes.dueDate = effStart;
          new Notice("截止时间不能早于开始时间，已自动调换");
        }
      }
    }

    // Quadrant mode: no listId auto-classification needed (aggregated view, tasks stay in original list)

    const p = this.plugin.taskService.update(taskId, changes).then(async (updated) => {
      if (updated && syncFutureRecurrence) {
        await this.plugin.taskService.syncRecurrenceSchedule(taskId, updated.startDate, updated.dueDate);
      }
      if (updated && syncFutureRecurrenceProperties) {
        await this.plugin.taskService.syncRecurrenceProperties(taskId, changes);
      }
      if (updated && this.taskId === taskId) this.applyValues(updated);
      if (this.pendingSave === p) this.pendingSave = null;
      this.onTaskUpdated?.(taskId);
    });
    this.pendingSave = p;
    return p;
  }

  private getTask(): Task | undefined {
    const taskId = this.taskId;
    if (!taskId) return undefined;
    return this.plugin.taskService.getAll().find((t) => t.id === taskId);
  }

  private formatDisplayDate(isoValue: string): string {
    if (!isoValue) return "";
    const d = new Date(isoValue);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdays[d.getDay()];
    if (h === "00" && m === "00") {
      return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + weekday;
    }
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + weekday + " " + h + ":" + m;
  }

  private formatCreatedDate(isoValue: string): string {
    if (!isoValue) return "";
    const d = new Date(isoValue);
    if (Number.isNaN(d.getTime())) return "";
    return "创建于 " + d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }



  private async deleteTask(task: Task): Promise<void> {
    if (task.recurrenceGroupId && task.recurrence) {
      await this.plugin.taskService.deleteSeries(task.recurrenceGroupId, task.id);
    } else {
      await this.plugin.taskService.delete(task.id);
    }
    new Notice("\u4efb\u52a1\u5df2\u5220\u9664");
    this.plugin.settings.selectedTaskId = null;
    await this.plugin.saveSettings();
    this.close();
    this.onClose?.();
    this.onTaskUpdated?.(task.id);
  }}
