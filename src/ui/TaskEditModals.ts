import { App, Modal } from "obsidian";
import { t } from "../i18n";

export class ConfirmModal extends Modal {
  private message: string;
  private confirmText: string;
  private cancelText: string;
  private warning: boolean;
  private resolve!: (value: boolean | null) => void;
  private settled = false;

  constructor(app: App, message: string, confirmText = "确认", cancelText = "取消", warning = true) {
    super(app);
    this.message = t(message);
    this.confirmText = t(confirmText);
    this.cancelText = t(cancelText);
    this.warning = warning;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const actions = contentEl.createDiv({ cls: "todo-prompt-actions" });
    const cancelBtn = actions.createEl("button", { text: this.cancelText });
    const confirmBtn = actions.createEl("button", { text: this.confirmText, cls: this.warning ? "mod-warning" : "" });
    cancelBtn.addEventListener("click", () => this.finish(false));
    confirmBtn.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }

  async openAndConfirm(): Promise<boolean | null> {
    return new Promise<boolean | null>((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private finish(value: boolean | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }
}
export class WeekSplitModal extends Modal {
  private resolve!: (value: string | null) => void;
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("请输入拆分天数（1-7）") });
    const input = contentEl.createEl("input", { type: "number", cls: "todo-prompt-input" });
    input.min = "1"; input.max = "7"; input.step = "1"; input.value = "2";
    const actions = contentEl.createDiv({ cls: "todo-prompt-actions" });
    const cancel = actions.createEl("button", { text: t("取消") });
    const confirm = actions.createEl("button", { text: t("确认"), cls: "mod-cta" });
    cancel.addEventListener("click", () => { this.resolve(null); this.close(); });
    confirm.addEventListener("click", () => { this.resolve(input.value); this.close(); });
    window.setTimeout(() => input.focus(), 30);
  }
  onClose(): void { this.contentEl.empty(); }
  openAndGetValue(): Promise<string | null> { return new Promise((resolve) => { this.resolve = resolve; this.open(); }); }
}
export class NoteEditModal extends Modal {
  private note: string;
  private resolve!: (value: string) => void;
  constructor(app: App, note: string) {
    super(app);
    this.note = note;
  }
  onOpen(): void {
    this.contentEl.addClass('todo-note-edit-modal');
    this.contentEl.createDiv({ cls: 'todo-rec-title', text: '编辑备注' });
    const ta = this.contentEl.createEl('textarea', { cls: 'todo-note-edit-textarea' }) as HTMLTextAreaElement;
    ta.value = this.note;
    ta.rows = 8;
    ta.addEventListener('input', () => { this.note = ta.value; });
    const actions = this.contentEl.createDiv({ cls: 'todo-dp-actions' });
    actions.createEl('button', { text: '取消' }).addEventListener('click', () => { this.resolve(this.note); this.close(); });
    actions.createEl('button', { text: '保存', cls: 'mod-cta' }).addEventListener('click', () => { this.resolve(ta.value); this.close(); });
    window.setTimeout(() => ta.focus(), 30);
  }
  onClose(): void { this.contentEl.empty(); }
  async openAndEdit(): Promise<string> {
    return new Promise<string>((resolve) => { this.resolve = resolve; this.open(); });
  }
}
