import { App, Modal } from "obsidian";
import { t } from "../i18n";

const STEPS = [
  {
    title: "我的一天",
    body: "把今天要做的任务安排在这里。你可以创建任务、分配时间段，并在完成后勾选。",
  },
  {
    title: "逐层拆解计划",
    body: "从人生方向到年度、月度和周目标逐层推进，让长期目标落到每周行动。",
  },
  {
    title: "父子任务",
    body: "周目标可以关联普通任务。完成全部子任务会自动完成父任务，父级标签也会同步到后代。",
  },
  {
    title: "日程与重复任务",
    body: "在日程中拖动任务调整时间；重复任务会生成后续实例，并保留已完成记录。",
  },
  {
    title: "待办事项推荐",
    body: "在“我的一天”中，根据未完成任务和本周目标生成待办建议。加入周目标建议后，会创建关联到周目标的普通日任务。",
  },
  {
    title: "复盘与数据",
    body: "用日、周、月、年复盘查看完成情况。任务数据保存在当前库中，并提供自动备份。",
  },
];

export class OnboardingModal extends Modal {
  private stepIndex = 0;
  private completed = false;
  private onFinish: () => void | Promise<void>;

  constructor(app: App, onFinish: () => void | Promise<void>) {
    super(app);
    this.onFinish = onFinish;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-onboarding");
    this.renderStep();
  }

  onClose(): void {
    this.finish();
  }

  private renderStep(): void {
    this.contentEl.empty();
    const step = STEPS[this.stepIndex];
    this.contentEl.createDiv({ cls: "todo-onboarding-brand", text: t("欢迎使用 Plan to Day") });
    this.contentEl.createDiv({ cls: "todo-onboarding-progress", text: `${t("步骤")} ${this.stepIndex + 1} / ${STEPS.length}` });
    this.contentEl.createEl("h2", { cls: "todo-onboarding-title", text: t(step.title) });
    this.contentEl.createDiv({ cls: "todo-onboarding-body", text: t(step.body) });

    const actions = this.contentEl.createDiv({ cls: "todo-onboarding-actions" });
    const skip = actions.createEl("button", { text: t("跳过引导"), cls: "todo-onboarding-skip" });
    skip.addEventListener("click", () => this.close());

    const navigation = actions.createDiv({ cls: "todo-onboarding-navigation" });
    if (this.stepIndex > 0) {
      navigation.createEl("button", { text: t("上一步") }).addEventListener("click", () => {
        this.stepIndex--;
        this.renderStep();
      });
    }
    const next = navigation.createEl("button", {
      text: t(this.stepIndex === STEPS.length - 1 ? "完成引导" : "下一步"),
      cls: "mod-cta",
    });
    next.addEventListener("click", () => {
      if (this.stepIndex === STEPS.length - 1) {
        this.close();
      } else {
        this.stepIndex++;
        this.renderStep();
      }
    });
  }

  private finish(): void {
    if (this.completed) return;
    this.completed = true;
    void Promise.resolve(this.onFinish()).catch((error) => {
      console.error("Failed to save onboarding state:", error);
    });
  }
}
