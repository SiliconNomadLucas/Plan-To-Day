import { App, Modal, setIcon } from "obsidian";
import { getLunarDisplayText, isLunarSpecialDay } from "../utils/lunar";
import { ageFromDueDate, currentAge } from "../utils/period";
import { isEnglish } from "../i18n";

export class DatePickerModal extends Modal {
  private currentDate: Date;
  private onSelect: (isoDate: string | null) => void;
  private onLinkedUpdate?: (startIso: string, endIso: string) => void;
  private mode: "start" | "end";
  private selectedHour: number;
  private selectedMinute: number;
  private showLunar: boolean;

  constructor(
    app: App,
    currentIsoDate: string | null,
    mode: "start" | "end",
    onSelect: (isoDate: string | null) => void,
    onLinkedUpdate?: (startIso: string, endIso: string) => void,
    showLunar?: boolean
  ) {
    super(app);
    this.mode = mode;
    this.onSelect = onSelect;
    this.onLinkedUpdate = onLinkedUpdate;
    this.showLunar = showLunar ?? false;
    const d = currentIsoDate ? new Date(currentIsoDate) : new Date();
    this.currentDate = Number.isNaN(d.getTime()) ? new Date() : d;
    this.selectedHour = this.currentDate.getHours();
    this.selectedMinute = Math.round(this.currentDate.getMinutes() / 15) * 15 % 60;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-date-picker");
    this.renderCalendar(this.currentDate.getFullYear(), this.currentDate.getMonth());
  }

  onClose(): void { this.contentEl.empty(); }

    private formatIso(d: Date, h: number, m: number): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(h) + ":" + pad(m) + ":00";
  }

  private renderCalendar(year: number, month: number): void {
    this.contentEl.empty();
    const selY = this.currentDate.getFullYear();
    const selM = this.currentDate.getMonth();
    const selD = this.currentDate.getDate();

    // Month navigation
    const nav = this.contentEl.createDiv({ cls: "todo-dp-nav" });
    nav.createEl("button", { cls: "todo-dp-nav-btn", text: "\u276e" }).addEventListener("click", () => {
      this.renderCalendar(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
    });
    nav.createDiv({ cls: "todo-dp-nav-title", text: year + "年" + (month + 1) + "月" });
    nav.createEl("button", { cls: "todo-dp-nav-btn", text: "\u276f" }).addEventListener("click", () => {
      this.renderCalendar(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
    });

    // Weekday headers
    const wd = this.contentEl.createDiv({ cls: "todo-dp-weekdays" });
    ["一","二","三","四","五","六","日"].forEach((d) => wd.createDiv({ cls: "todo-dp-weekday", text: d }));

    // Day grid
    const grid = this.contentEl.createDiv({ cls: "todo-dp-grid" });
    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < offset; i++) { grid.createDiv({ cls: "todo-dp-day todo-dp-day-empty" }); }
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEl = grid.createDiv({ cls: "todo-dp-day" });
      dayEl.createSpan({ cls: "todo-dp-day-num", text: String(day) });
      if (this.showLunar) {
        const lunarText = getLunarDisplayText(year, month + 1, day);
        const lunarCls = "todo-dp-lunar" + (isLunarSpecialDay(year, month + 1, day) ? " todo-lunar-festival" : "");
        dayEl.createSpan({ cls: lunarCls, text: lunarText });
      }
      if (year === selY && month === selM && day === selD) dayEl.addClass("is-selected");
      dayEl.addEventListener("click", () => {
        this.currentDate = new Date(year, month, day);
        this.renderCalendar(year, month);
      });
    }
    const trailing = 42 - offset - daysInMonth;
    for (let i = 0; i < trailing; i++) { grid.createDiv({ cls: "todo-dp-day todo-dp-day-empty" }); }

    // Time picker
    const timeRow = this.contentEl.createDiv({ cls: "todo-dp-time" });
    const hourSelect = timeRow.createEl("select", { cls: "todo-dp-time-select" });
    for (let h = 0; h < 24; h++) {
      const opt = hourSelect.createEl("option", { value: String(h), text: String(h).padStart(2, "0") });
      if (h === this.selectedHour) opt.selected = true;
    }
    hourSelect.addEventListener("change", () => {
      this.selectedHour = parseInt(hourSelect.value);
    });
    timeRow.createSpan({ text: " : " });
    const minuteSelect = timeRow.createEl("select", { cls: "todo-dp-time-select" });
    [0, 15, 30, 45].forEach((m) => {
      const opt = minuteSelect.createEl("option", { value: String(m), text: String(m).padStart(2, "0") });
      if (m === this.selectedMinute) opt.selected = true;
    });
    minuteSelect.addEventListener("change", () => {
      this.selectedMinute = parseInt(minuteSelect.value);
    });

    // Quick time presets
    const presets = this.contentEl.createDiv({ cls: "todo-dp-presets" });
    const presetData = [
      { label: "全天", icon: "clock", hour: 7, minute: 0, endHour: 23, endMinute: 30 },
      { label: "早上", icon: "sunrise", hour: 7, minute: 0, endHour: 11, endMinute: 59 },
      { label: "中午", icon: "sun", hour: 12, minute: 0, endHour: 13, endMinute: 59 },
      { label: "下午", icon: "sun-dim", hour: 14, minute: 0, endHour: 17, endMinute: 59 },
      { label: "晚上", icon: "moon", hour: 18, minute: 0, endHour: 23, endMinute: 30 },
    ];
    presetData.forEach((p) => {
      const btn = presets.createEl("button", { cls: "todo-dp-preset-btn" });
      setIcon(btn, p.icon);
      btn.createSpan({ text: p.label });
      btn.addEventListener("click", () => {
        this.selectedHour = p.hour;
        this.selectedMinute = p.minute;
        this.currentDate.setHours(p.hour, p.minute);
        hourSelect.value = String(p.hour);
        minuteSelect.value = String(p.minute);
        if (this.mode === "start" && this.onLinkedUpdate) {
          const startIso = this.formatIso(this.currentDate, p.hour, p.minute);
          const endDate = new Date(this.currentDate);
          endDate.setHours(p.endHour, p.endMinute);
          const endIso = this.formatIso(endDate, p.endHour, p.endMinute);
          this.onLinkedUpdate(startIso, endIso);
        }
      });
    });
    // Action buttons
    const actions = this.contentEl.createDiv({ cls: "todo-dp-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: "保存", cls: "mod-cta" }).addEventListener("click", () => {
      this.currentDate.setHours(this.selectedHour, this.selectedMinute);
      const isoStr = this.formatIso(this.currentDate, this.selectedHour, this.selectedMinute);
      this.onSelect(isoStr);
      this.close();
    });
  }
}
export class AgePickerModal extends Modal {
  private birthday: string;
  private currentAge: number;
  private selectedAge: number;
  private onSelect: (isoDate: string | null) => void;

  constructor(app: App, birthday: string, currentDueDate: string | null, onSelect: (isoDate: string | null) => void) {
    super(app);
    this.birthday = birthday;
    this.currentAge = currentAge(birthday);
    this.selectedAge = currentDueDate ? ageFromDueDate(birthday, currentDueDate) : this.currentAge;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-age-picker");
    this.renderContent();
  }

  onClose(): void { this.contentEl.empty(); }

  private renderContent(): void {
    this.contentEl.empty();

    // Current age info
    const infoEl = this.contentEl.createDiv({ cls: "todo-age-info" });
    infoEl.createSpan({ text: "\u5f53\u524d\u5e74\u9f84\uff1a" + this.currentAge + " \u5c81" });

    // Age selector row
    const selectorRow = this.contentEl.createDiv({ cls: "todo-age-selector" });
    const minusBtn = selectorRow.createEl("button", { cls: "todo-age-btn", text: "\u2212" });
    minusBtn.addEventListener("click", () => {
      if (this.selectedAge > 0) {
        this.selectedAge--;
        this.renderContent();
      }
    });

    const ageInput = selectorRow.createEl("input", {
      cls: "todo-age-input",
      attr: { type: "number", min: "0", max: "100" }
    }) as HTMLInputElement;
    ageInput.value = String(this.selectedAge);
    ageInput.addEventListener("change", () => {
      const val = parseInt(ageInput.value, 10);
      if (!isNaN(val) && val >= 0 && val <= 100) {
        this.selectedAge = val;
        this.renderContent();
      }
    });

    const plusBtn = selectorRow.createEl("button", { cls: "todo-age-btn", text: "+" });
    plusBtn.addEventListener("click", () => {
      if (this.selectedAge < 100) {
        this.selectedAge++;
        this.renderContent();
      }
    });

    // Quick age buttons
    const quickRow = this.contentEl.createDiv({ cls: "todo-age-quick" });
    const milestones = [18, 20, 25, 30, 35, 40, 50, 60];
    milestones.forEach((age) => {
      if (age >= 0 && age <= 100) {
        const btn = quickRow.createEl("button", { cls: "todo-age-quick-btn" + (age === this.selectedAge ? " is-selected" : ""), text: String(age) });
        btn.addEventListener("click", () => {
          this.selectedAge = age;
          this.renderContent();
        });
      }
    });

    // Action buttons
    const actions = this.contentEl.createDiv({ cls: "todo-age-actions" });
    actions.createEl("button", { text: "\u53d6\u6d88" }).addEventListener("click", () => this.close());
    actions.createEl("button", { text: "\u4fdd\u5b58", cls: "mod-cta" }).addEventListener("click", () => {
      const bd = new Date(this.birthday);
      const dueDate = new Date(bd.getFullYear() + this.selectedAge, bd.getMonth(), bd.getDate());
      const pad = (n: number) => String(n).padStart(2, "0");
      const isoStr = dueDate.getFullYear() + "-" + pad(dueDate.getMonth() + 1) + "-" + pad(dueDate.getDate()) + "T07:00:00";
      this.onSelect(isoStr);
      this.close();
    });
  }
}
export class RecurrencePickerModal extends Modal {
  private currentRecurrence: string | null;
  private onSelect: (recurrence: string | null) => void;

  constructor(app: App, currentRecurrence: string | null, onSelect: (recurrence: string | null) => void) {
    super(app);
    this.currentRecurrence = currentRecurrence;
    this.onSelect = onSelect;
  }

  onOpen(): void {
    this.contentEl.addClass("todo-recurrence-picker");
    this.contentEl.createDiv({ cls: "todo-rec-title", text: "设置重复" });

    const options: { label: string; value: string }[] = [
      { label: "每天", value: "daily" },
      { label: "每周", value: "weekly" },
      { label: "每月", value: "monthly" },
      { label: "每年", value: "yearly" },
      ...(!isEnglish() ? [{ label: "每年（农历）", value: "lunar-yearly" }] : []),
    ];

    options.forEach((opt) => {
      const item = this.contentEl.createDiv({ cls: "todo-rec-option" + (this.currentRecurrence === opt.value ? " is-selected" : "") });
      item.textContent = opt.label;
      item.addEventListener("click", () => { this.onSelect(opt.value); this.close(); });
    });

    const customItem = this.contentEl.createDiv({ cls: "todo-rec-option" });
    customItem.textContent = "自定义";
    customItem.addEventListener("click", () => { this.contentEl.empty(); this.renderCustomPanel(); });
  }

  onClose(): void { this.contentEl.empty(); }

  private renderCustomPanel(): void {
    this.contentEl.createDiv({ cls: "todo-rec-title", text: "自定义重复" });

    const intervalRow = this.contentEl.createDiv({ cls: "todo-rec-row" });
    intervalRow.createEl("span", { text: "每 " });
    const intervalInput = intervalRow.createEl("input", { attr: { type: "number", min: "1", value: "1" } }) as HTMLInputElement;
    intervalInput.style.width = "50px";
    const unitSelect = intervalRow.createEl("select") as HTMLSelectElement;
    [{ v: "day", l: "天" }, { v: "week", l: "周" }, { v: "month", l: "月" }, { v: "year", l: "年" }, ...(!isEnglish() ? [{ v: "lunar-monthly", l: "农历月" }, { v: "lunar-yearly", l: "农历年" }] : [])].forEach((u) => {
      const opt = unitSelect.createEl("option", { value: u.v, text: u.l });
      if (u.v === "day") opt.selected = true;
    });

    const actions = this.contentEl.createDiv({ cls: "todo-dp-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => { this.contentEl.empty(); this.onOpen(); });
    actions.createEl("button", { text: "保存", cls: "mod-cta" }).addEventListener("click", () => {
      const interval = Math.max(1, parseInt(intervalInput.value) || 1);
      const unit = unitSelect.value;
        const rec = unit.startsWith("lunar-") ? unit : "custom:" + interval + ":" + unit;
        this.onSelect(rec);
      this.close();
    });
  }
}
