import { App, Modal, setIcon } from "obsidian";
import type { TodoPluginLike } from "../views/TodoView";
import type { Task, PlanKind } from "../models/Task";
import type { TaskService } from "../services/TaskService";
import { getPeriodKeyForDate, getParentPeriodKey } from "../utils/period";
import { systemTagName } from "../i18n";

export class TagPickerModal extends Modal {
  private plugin: TodoPluginLike;
  private selectedIds: string[];
  private onConfirm: (ids: string[]) => void;
  private excludeQuadrant: boolean;

  constructor(app: App, plugin: TodoPluginLike, selectedIds: string[], onConfirm: (ids: string[]) => void, excludeQuadrant = false) {
    super(app);
    this.plugin = plugin;
    this.selectedIds = [...selectedIds];
    this.onConfirm = onConfirm;
    this.excludeQuadrant = excludeQuadrant;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-tag-picker");
    this.contentEl.createDiv({ cls: "todo-tag-picker-title", text: "选择标签" });

    const searchInput = this.contentEl.createEl("input", {
      cls: "todo-tag-picker-search",
      attr: { type: "text", placeholder: "搜索标签..." },
    }) as HTMLInputElement;

    const gridEl = this.contentEl.createDiv({ cls: "todo-tag-picker-grid" });
    const allTags = this.plugin.tagService.getAll().filter((t) => !this.excludeQuadrant || t.sortOrder >= 4);

    const renderGrid = (filter: string) => {
      gridEl.empty();
      const lower = filter.toLowerCase();
      const filtered = allTags.filter((t) => !lower || t.name.toLowerCase().includes(lower));
      for (const tag of filtered) {
        const isSelected = this.selectedIds.includes(tag.id);
        const opt = gridEl.createDiv({ cls: "todo-tag-option" + (isSelected ? " is-selected" : "") });
        opt.style.setProperty("--tag-color", tag.color);

        const optIcon = opt.createSpan({ cls: "todo-tag-option-icon" });
        setIcon(optIcon, tag.icon);
        opt.createSpan({ cls: "todo-tag-option-name", text: systemTagName(tag) });
        opt.addEventListener("click", () => {
          if (this.selectedIds.includes(tag.id)) {
            this.selectedIds = this.selectedIds.filter((id) => id !== tag.id);
          } else {
            // Quadrant tags (sortOrder < 4) are mutually exclusive
            if (tag.sortOrder < 4) {
              const quadrantIds = allTags.filter((t) => t.sortOrder < 4).map((t) => t.id);
              this.selectedIds = this.selectedIds.filter((id) => !quadrantIds.includes(id));
            }
            this.selectedIds.push(tag.id);
          }
          this.onConfirm(this.selectedIds);
          renderGrid(searchInput.value);
        });
      }
      if (filtered.length === 0) {
        gridEl.createDiv({ cls: "todo-tag-picker-empty", text: "没有匹配的标签" });
      }
    };

    searchInput.addEventListener("input", () => renderGrid(searchInput.value));
    renderGrid("");

    const actions = this.contentEl.createDiv({ cls: "todo-tag-picker-actions" });
    actions.createEl("button", { text: "关闭", cls: "mod-cta" }).addEventListener("click", () => this.close());
  }

  onClose(): void { this.contentEl.empty(); }
}
export class ParentPickerModal extends Modal {
  private ts: Pick<TaskService, "getAll">;
  private excludeIds: string[];
  private onSelect: (id: string) => void;
  private mode: "parent" | "child";
  private task: Task;

  constructor(app: App, ts: Pick<TaskService, "getAll">, excludeIds: string[], onSelect: (id: string) => void, mode: "parent" | "child", task: Task) {
    super(app);
    this.ts = ts;
    this.excludeIds = excludeIds;
    this.onSelect = onSelect;
    this.mode = mode;
    this.task = task;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-parent-picker");
    const title = this.mode === "parent" ? "\u9009\u62e9\u7236\u4efb\u52a1" : "\u9009\u62e9\u5b50\u4efb\u52a1";
    this.contentEl.createDiv({ cls: "todo-parent-picker-title", text: title });
    const searchInput = this.contentEl.createEl("input", { cls: "todo-parent-picker-search", attr: { type: "text", placeholder: "\u641c\u7d22\u4efb\u52a1..." } }) as HTMLInputElement;
    const listEl = this.contentEl.createDiv({ cls: "todo-parent-picker-list" });
    const CHILD_KIND: Record<string, string> = { life: "year", year: "quarter", quarter: "month", month: "week" };
    const PARENT_KIND: Record<string, string> = { year: "life", quarter: "year", month: "quarter", week: "month" };
    const isOrdinaryTask = !this.task.planKind;
    const isOrdinaryParentPicker = this.mode === "parent" && isOrdinaryTask;
    const isWeekPlanChildPicker = this.mode === "child" && this.task.planKind === "week";
    const targetKind = this.task.planKind
      ? (this.mode === "parent" ? PARENT_KIND[this.task.planKind] : CHILD_KIND[this.task.planKind])
      : isOrdinaryParentPicker ? "week" : undefined;
    const renderList = (filter: string) => {
      listEl.empty();
      if (!targetKind && !isOrdinaryTask && !isWeekPlanChildPicker) {
        listEl.createDiv({ cls: "todo-parent-picker-empty", text: "\u65e0\u53ef\u9009\u4efb\u52a1" });
        return;
      }
      const all = this.ts.getAll().filter((t) => {
        if (t.isDeleted || t.isRecurrenceTemplate) return false;
        if (this.excludeIds.includes(t.id)) return false;
        if (targetKind && t.planKind !== targetKind) return false;
        if (isWeekPlanChildPicker && t.planKind) return false;
        // Period key matching
        if (this.mode === "parent" && this.task.planKind && targetKind !== "life") {
          const expectedKey = getParentPeriodKey(this.task.planKind, this.task.planPeriodKey || "");
          return t.planPeriodKey === expectedKey;
        }
        if (this.mode === "child" && this.task.planKind && targetKind) {
          const candidateParentKey = getParentPeriodKey(targetKind as PlanKind, t.planPeriodKey || "");
          return candidateParentKey === this.task.planPeriodKey;
        }
        if (isOrdinaryParentPicker) {
          const dateStr = this.task.dueDate || this.task.startDate;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return t.planPeriodKey === getPeriodKeyForDate(date, "week");
            }
          }
        }
        if (isWeekPlanChildPicker && this.task.planPeriodKey) {
          const dateStr = t.dueDate || t.startDate;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              return getPeriodKeyForDate(date, "week") === this.task.planPeriodKey;
            }
          }
        }
        return true;
      });
      const lower = filter.toLowerCase();
      const matched = filter ? all.filter((t) => (t.title || "").toLowerCase().includes(lower)) : all;
      const shown = matched.slice(0, 30);
      if (shown.length === 0) {
        listEl.createDiv({ cls: "todo-parent-picker-empty", text: "\u65e0\u5339\u914d\u4efb\u52a1" });
        return;
      }
      for (const t of shown) {
        const item = listEl.createDiv({ cls: "todo-parent-picker-item" });
        item.createSpan({ cls: "todo-parent-picker-item-title", text: t.title || "\u672a\u547d\u547d" });
        if (t.planPeriodKey) {
          item.createSpan({ cls: "todo-parent-picker-item-badge", text: t.planPeriodKey });
        }
        item.addEventListener("click", () => {
          this.onSelect(t.id);
          this.close();
        });
      }};
    searchInput.addEventListener("input", () => renderList(searchInput.value));
    renderList("");
    window.setTimeout(() => searchInput.focus(), 30);
  }

  onClose(): void { this.contentEl.empty(); }
}
