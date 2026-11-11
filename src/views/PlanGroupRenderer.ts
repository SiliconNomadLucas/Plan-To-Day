import type { Task, PlanKind } from "../models/Task";
import type { TaskService } from "../services/TaskService";
import {
  currentPeriodKey,
  getSubPeriodKeysForParent,
  periodKeySort,
} from "../utils/period";
import { isEnglish } from "../i18n";
import { runAsyncAction } from "../utils/async-action";
import {
  localizedPeriodLabel,
  localizedSubGroupLabel,
} from "../utils/plan-labels";

interface PlanGroupCallbacks {
  renderTaskRow(container: HTMLDivElement, task: Task): void;
  isMobile(): boolean;
  promptPlanCreate(kind: PlanKind, periodKey: string): Promise<void>;
  onTaskCreated(): Promise<void>;
}

export class PlanGroupRenderer {
  constructor(
    private readonly taskService: Pick<TaskService, "getAll" | "getByPlanKindAndPeriod" | "create">,
    private readonly callbacks: PlanGroupCallbacks,
  ) {}

  renderPlan(container: HTMLDivElement, kind: PlanKind): void {
    const currentKey = currentPeriodKey(kind);
    const keys = new Set(
      this.taskService.getAll()
        .filter((task) => task.planKind === kind && task.planPeriodKey)
        .map((task) => task.planPeriodKey!),
    );
    keys.add(currentKey);
    const subKind: PlanKind | null = kind === "year" ? "quarter" : kind === "month" ? "week" : null;
    const currentSubKey = currentPeriodKey(subKind || "week");

    for (const periodKey of periodKeySort(kind, [...keys])) {
      const tasks = this.taskService.getByPlanKindAndPeriod(kind, periodKey);
      const isCurrent = periodKey === currentKey;
      const group = container.createDiv({ cls: "todo-plan-group" });
      const header = group.createDiv({ cls: "todo-plan-group-header" });
      const arrow = header.createSpan({
        cls: "todo-plan-group-arrow" + (isCurrent ? "" : " collapsed"),
        text: "\u25bc",
      });
      header.createSpan({
        cls: "todo-plan-group-label",
        text: localizedPeriodLabel(kind, periodKey, isEnglish()),
      });
      header.createSpan({ cls: "todo-plan-group-count", text: String(tasks.length) });
      const addButton = header.createSpan({ cls: "todo-plan-add-btn", text: "+" });
      addButton.title = "\u65b0\u5efa\u4efb\u52a1";
      const body = group.createDiv({ cls: "todo-plan-group-body" });
      body.dataset.periodKey = periodKey;
      body.toggleClass("todo-is-hidden", !isCurrent);
      for (const task of tasks) this.callbacks.renderTaskRow(body, task);
      this.setupAddButton(addButton, body, kind, periodKey);
      this.attachCollapse(header, body, arrow);

      if (!subKind) continue;
      const subKeys = periodKeySort(subKind, getSubPeriodKeysForParent(kind, periodKey));
      for (const subKey of subKeys) {
        const subTasks = this.taskService.getByPlanKindAndPeriod(subKind, subKey);
        const isCurrentSub = subKey === currentSubKey;
        const subGroup = body.createDiv({ cls: "todo-plan-subgroup" });
        const subHeader = subGroup.createDiv({ cls: "todo-plan-subgroup-header" });
        const subArrow = subHeader.createSpan({
          cls: "todo-plan-group-arrow" + (isCurrentSub ? "" : " collapsed"),
          text: "\u25bc",
        });
        subHeader.createSpan({
          cls: "todo-plan-subgroup-label",
          text: localizedSubGroupLabel(subKind, subKey, isEnglish()),
        });
        subHeader.createSpan({ cls: "todo-plan-group-count", text: String(subTasks.length) });
        const subAddButton = subHeader.createSpan({ cls: "todo-plan-add-btn", text: "+" });
        subAddButton.title = "\u65b0\u5efa\u4efb\u52a1";
        const subBody = subGroup.createDiv({ cls: "todo-plan-group-body" });
        subBody.dataset.periodKey = subKey;
        subBody.toggleClass("todo-is-hidden", !isCurrentSub);
        for (const task of subTasks) this.callbacks.renderTaskRow(subBody, task);
        this.setupAddButton(subAddButton, subBody, subKind, subKey);
        this.attachCollapse(subHeader, subBody, subArrow);
      }
    }
  }

  renderGoalList(container: HTMLElement, kind: "year" | "month", periodKey: string): void {
    const subKind: PlanKind = kind === "year" ? "quarter" : "week";
    const currentSubKey = currentPeriodKey(subKind);
    const subKeys = periodKeySort(subKind, getSubPeriodKeysForParent(kind, periodKey));
    for (const subKey of subKeys) {
      const tasks = this.taskService.getByPlanKindAndPeriod(subKind, subKey);
      const group = container.createDiv({ cls: "todo-plan-subgroup" });
      const header = group.createDiv({ cls: "todo-plan-subgroup-header" });
      const expanded = subKey === currentSubKey;
      const arrow = header.createSpan({
        cls: "todo-plan-group-arrow" + (expanded ? "" : " collapsed"),
        text: "\u25bc",
      });
      header.createSpan({
        cls: "todo-plan-subgroup-label",
        text: localizedSubGroupLabel(subKind, subKey, isEnglish()),
      });
      header.createSpan({ cls: "todo-plan-group-count", text: String(tasks.length) });
      const addButton = header.createSpan({ cls: "todo-plan-add-btn", text: "+" });
      addButton.title = "\u65b0\u5efa\u4efb\u52a1";
      const body = group.createDiv({ cls: "todo-plan-group-body" });
      body.dataset.periodKey = subKey;
      body.toggleClass("todo-is-hidden", !expanded);
      for (const task of tasks) this.callbacks.renderTaskRow(body, task);
      this.setupAddButton(addButton, body, subKind, subKey);
      this.attachCollapse(header, body, arrow);
    }
  }

  private attachCollapse(header: HTMLElement, body: HTMLElement, arrow: HTMLElement): void {
    header.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.closest(".todo-plan-add-btn")) return;
      const expanded = body.classList.contains("todo-is-hidden");
      body.toggleClass("todo-is-hidden", !expanded);
      arrow.toggleClass("collapsed", !expanded);
    });
  }

  private setupAddButton(button: HTMLElement, body: HTMLElement, kind: PlanKind, periodKey: string): void {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.callbacks.isMobile()) {
        void this.callbacks.promptPlanCreate(kind, periodKey);
        return;
      }
      if (body.classList.contains("todo-is-hidden")) {
        body.removeClass("todo-is-hidden");
        body.parentElement?.querySelector(".todo-plan-group-arrow")?.removeClass("collapsed");
      }
      if (body.querySelector(".todo-plan-inline-input")) return;
      const row = body.createDiv({ cls: "todo-plan-inline-input" });
      const tasks = body.querySelectorAll(".todo-plan-group-body > .todo-task-item");
      const lastTask = tasks.length > 0 ? tasks[tasks.length - 1] : null;
      if (lastTask) lastTask.after(row);
      else body.prepend(row);
      const input = row.createEl("input", { attr: { placeholder: "\u8f93\u5165\u4efb\u52a1\u6807\u9898..." } });
      window.setTimeout(() => input.focus(), 30);
      let saved = false;
      const save = async () => {
        if (saved) return;
        saved = true;
        const title = input.value.trim();
        if (title) {
          await this.taskService.create({ title, planKind: kind, planPeriodKey: periodKey });
          await this.callbacks.onTaskCreated();
        } else {
          row.remove();
        }
      };
      input.addEventListener("keydown", (event) => { runAsyncAction((async () => {
        if (event.key === "Enter") { event.preventDefault(); await save(); }
        if (event.key === "Escape") { event.preventDefault(); saved = true; row.remove(); }
      })(), "PlanGroupRenderer interaction"); });
      input.addEventListener("blur", () => { void save(); });
    });
  }
}
