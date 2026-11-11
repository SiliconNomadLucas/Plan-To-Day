import { setIcon } from "obsidian";
import type { Task } from "../models/Task";
import type { DomainTag } from "../models/Tag";
import { systemTagName } from "../i18n";
import { ageFromDueDate, currentAge } from "../utils/period";

interface LifePlanCallbacks {
  getTasks(): Task[];
  getTags(): Array<Pick<DomainTag, "id" | "name" | "icon" | "isDefault">>;
  toggleCompletion(task: Task): Promise<void>;
  openTask(taskId: string): Promise<void>;
}

export class LifePlanRenderer {
  constructor(private readonly callbacks: LifePlanCallbacks) {}

  async render(root: HTMLDivElement, birthday: string): Promise<void> {
    root.empty();
    root.removeClass("todo-goal-active");
    root.addClass("todo-life-active");
    if (!birthday) {
      const hint = root.createDiv({ cls: "todo-life-empty" });
      hint.createSpan({ text: "\u8bf7\u5148\u5728\u8bbe\u7f6e\u4e2d\u586b\u5199\u751f\u65e5\uff0c\u624d\u80fd\u4f7f\u7528\u4eba\u751f\u8ba1\u5212\u89c6\u56fe\u3002" });
      return;
    }

    const lifeTasks = this.callbacks.getTasks().filter((task) => task.planKind === "life");
    const tags = this.callbacks.getTags();
    const withAge: Array<{ task: Task; age: number }> = [];
    const noAge: Task[] = [];
    for (const task of lifeTasks) {
      if (task.planPeriodKey) {
        withAge.push({ task, age: parseInt(task.planPeriodKey, 10) });
      } else if (task.dueDate) {
        withAge.push({ task, age: ageFromDueDate(birthday, task.dueDate) });
      } else {
        noAge.push(task);
      }
    }
    withAge.sort((a, b) => a.age - b.age);
    const groups = new Map<number, Task[]>();
    for (const { task, age } of withAge) {
      if (!groups.has(age)) groups.set(age, []);
      groups.get(age)!.push(task);
    }

    const ageNow = currentAge(birthday);
    const birthYear = new Date(birthday).getFullYear();
    const timeline = root.createDiv({ cls: "todo-life-timeline" });
    for (const [age, tasks] of groups) {
      const isCurrent = age === ageNow;
      const state = age < ageNow ? "past" : age > ageNow ? "future" : "current";
      const node = timeline.createDiv({ cls: "todo-life-node is-" + state });
      node.setAttribute("data-age-key", String(age));
      const ageColumn = node.createDiv({ cls: "todo-life-age-col" });
      const ageMain = ageColumn.createDiv({ cls: "todo-life-age-main" });
      ageMain.createSpan({ cls: "todo-life-age-num", text: String(age) });
      ageMain.createSpan({ cls: "todo-life-age-label", text: "\u5c81" });
      ageColumn.createDiv({ cls: "todo-life-age-year", text: String(birthYear + age) + "\u5e74" });
      const lineColumn = node.createDiv({ cls: "todo-life-line-col" });
      lineColumn.createDiv({ cls: "todo-life-dot" + (isCurrent ? " todo-life-dot-current" : "") });
      const content = node.createDiv({ cls: "todo-life-content-col" });
      for (const task of tasks) this.renderCard(content, task, tags, root, birthday);
    }

    if (noAge.length > 0) {
      timeline.createDiv({ cls: "todo-life-divider" });
      const node = timeline.createDiv({ cls: "todo-life-node" });
      const ageColumn = node.createDiv({ cls: "todo-life-age-col" });
      ageColumn.createDiv({ cls: "todo-life-age-na", text: "\u672a\u8bbe\u5b9a\u5e74\u9f84" });
      const lineColumn = node.createDiv({ cls: "todo-life-line-col" });
      lineColumn.createDiv({ cls: "todo-life-dot" });
      const content = node.createDiv({ cls: "todo-life-content-col" });
      for (const task of noAge) this.renderCard(content, task, tags, root, birthday);
    }

    if (groups.has(ageNow)) {
      timeline.querySelector(".todo-life-node.is-current")?.scrollIntoView({ block: "center" });
    }
  }

  private renderCard(
    container: HTMLElement,
    task: Task,
    tags: Array<Pick<DomainTag, "id" | "name" | "icon" | "isDefault">>,
    root: HTMLDivElement,
    birthday: string,
  ): void {
    const card = container.createDiv({ cls: "todo-life-card", attr: { "data-task-id": task.id } });
    const checkbox = card.createDiv({
      cls: "todo-checkbox" + (task.isCompleted ? " checked" : ""),
      text: task.isCompleted ? "\u2713" : "",
    });
    checkbox.addEventListener("click", async (event) => {
      event.stopPropagation();
      await this.callbacks.toggleCompletion(task);
      await this.render(root, birthday);
    });
    card.createSpan({
      cls: "todo-life-card-title" + (task.isCompleted ? " completed" : ""),
      text: task.title,
    });
    const cardTags = (task.tags || [])
      .map((id) => tags.find((tag) => tag.id === id))
      .filter((tag): tag is NonNullable<typeof tag> => !!tag);
    if (cardTags.length > 0) {
      const tagRow = card.createDiv({ cls: "todo-life-card-tags" });
      for (const tag of cardTags) {
        const chip = tagRow.createSpan({ cls: "todo-life-card-tag" });
        const icon = chip.createSpan({ cls: "todo-life-card-tag-icon" });
        setIcon(icon, tag.icon);
        chip.createSpan({ text: systemTagName(tag) });
      }
    }
    card.addEventListener("click", () => { void this.callbacks.openTask(task.id); });
  }
}
