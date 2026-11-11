import { App, Modal, PluginSettingTab, setIcon, Setting, type ButtonComponent, type SettingDefinitionItem } from "obsidian";
import type ObsidianTodoPlugin from "../main";
import type { ViewNav } from "./views/TodoView";
import type { PlanKind } from "./models/Task";
import type { DomainTag } from "./models/Tag";
import { logger, LogLevel } from "./utils/logger";
import type { SortConfig } from "./utils/sort";
import { isEnglish, localizeDom, setLanguage, systemTagName, t, type TodoLanguage } from "./i18n";
import { OnboardingModal } from "./ui/OnboardingModal";
import { runAsyncAction } from "./utils/async-action";

export interface ObsidianTodoSettings {
  language: TodoLanguage;
  todoFolder: string;
  defaultListName: string;
  logLevel: string;
  activeViewNav: ViewNav;
  selectedListId: string | null;
  completedCollapsed: boolean;
  overdueCollapsed: boolean;
  selectedTaskId: string | null;
  selectedQuadrant: string | null;
  activePlanKind: PlanKind | null;
  sortConfig: SortConfig;
  birthday: string;
  onboardingCompleted: boolean;
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
}

export const DEFAULT_SETTINGS: ObsidianTodoSettings = {
  language: "zh",
  todoFolder: "todo",
  defaultListName: "Tasks",
  logLevel: "ERROR",
  activeViewNav: "myday",
  selectedListId: null,
  completedCollapsed: true,
  overdueCollapsed: true,
  selectedTaskId: null,
  sortConfig: {
    primary: { field: "importance", direction: "desc" },
    secondary: { field: "createdAt", direction: "desc" },
  },
  selectedQuadrant: null,
  activePlanKind: null,
  birthday: "",
  onboardingCompleted: false,
  planGroupCollapsed: true,
  quadrantGroupCollapsed: true,
  activeScheduleMode: "month",
  activeReviewMode: "day",
  taskFilterStatus: "active",
  goalViewMode: "card",
  showLunarCalendar: true,
  showDailyRecurringInDaySchedule: true,
  showDailyRecurringInWeekSchedule: true,
  showDailyRecurringInMonthSchedule: true,
  planningIntensity: "balanced",
};

const ICON_OPTIONS = [
  "book", "book-open", "library", "book-marked", "newspaper",
  "film", "clapperboard", "video", "tv", "popcorn",
  "music", "headphones", "mic", "radio", "disc-3",
  "map-pin", "map", "globe", "compass", "plane",
  "shopping-cart", "shopping-basket", "shopping-bag", "store",
  "tag", "utensils", "chef-hat", "cooking-pot", "coffee", "cake",
  "home", "sofa", "bed", "lamp", "washing-machine",
  "heart-pulse", "activity", "stethoscope", "pill", "hospital",
  "dumbbell", "footprints", "bike", "timer", "trophy",
  "briefcase", "building-2", "clipboard-list", "kanban", "list-checks",
  "piggy-bank", "banknote", "coins", "calculator", "receipt",
  "users", "user-round", "heart-handshake", "message-circle", "phone",
  "repeat", "calendar-check", "check-check", "circle-check", "alarm-clock",
];

export class ObsidianTodoSettingTab extends PluginSettingTab {
  plugin: ObsidianTodoPlugin;

  constructor(app: App, plugin: ObsidianTodoPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group", heading: t("基本设置"), items: [
          { name: t("数据存储文件夹"), desc: t("任务数据文件存储在 Vault 中的文件夹路径"), control: { type: "text", key: "todoFolder", placeholder: "todo" } },
          { name: t("默认列表名称"), desc: t("首次运行时自动创建的默认列表名称"), control: { type: "text", key: "defaultListName", placeholder: "Tasks" } },
          { name: t("生日"), desc: t("用于人生计划视图计算年龄（格式：YYYY-MM-DD）"), render: (setting) => this.addBirthdayControl(setting) },
          { name: t("新手引导"), desc: t("查看插件功能介绍"), render: (setting) => {
            setting.addButton((button) => button.setButtonText(t("重新打开新手引导")).onClick(() => this.openOnboarding()));
          } },
        ],
      },
      {
        type: "group", heading: t("显示设置"), items: [
          { name: t("语言"), desc: t("选择插件界面语言"), control: { type: "dropdown", key: "language", options: { zh: t("中文"), en: t("英文") } } },
          { name: t("显示农历"), desc: t("在日历、日程视图和日期选择器中显示农历日期、节日和节气"), visible: () => !isEnglish(), control: { type: "toggle", key: "showLunarCalendar" } },
          { name: t("在日视图显示每日重复任务"), desc: t("控制每日重复任务是否出现在日视图的日程中"), control: { type: "toggle", key: "showDailyRecurringInDaySchedule" } },
          { name: t("在周视图显示每日重复任务"), desc: t("控制每日重复任务是否出现在周视图的日程中"), control: { type: "toggle", key: "showDailyRecurringInWeekSchedule" } },
          { name: t("在月视图显示每日重复任务"), desc: t("控制每日重复任务是否出现在月视图的日程中"), control: { type: "toggle", key: "showDailyRecurringInMonthSchedule" } },
        ],
      },
      {
        type: "group", heading: t("标签管理"), items: [
          { name: t("四象限标签"), desc: t("用于四象限视图的任务分类"), render: (setting) => this.renderTagDefinition(setting, "四象限标签", this.plugin.tagService.getAll().filter((tag) => tag.sortOrder < 4), false, "用于四象限视图的任务分类") },
          { name: t("领域标签"), desc: t("用于人生领域维度的任务分类"), render: (setting) => this.renderTagDefinition(setting, "领域标签", this.plugin.tagService.getAll().filter((tag) => tag.sortOrder >= 4), false, "用于人生领域维度的任务分类") },
          { name: t("自定义标签"), desc: t("自由创建的个性化标签"), render: (setting) => this.renderTagDefinition(setting, "自定义标签", this.plugin.tagService.getAll().filter((tag) => !tag.isDefault), true, "自由创建的个性化标签") },
        ],
      },
      {
        type: "group", heading: t("高级设置"), items: [
          { name: t("日志级别"), desc: t("控制控制台日志的详细程度"), control: { type: "dropdown", key: "logLevel", options: { DEBUG: t("调试"), INFO: t("信息"), WARN: t("警告"), ERROR: t("错误") } } },
        ],
      },
      {
        type: "group", heading: t("数据管理"), items: [
          { name: t("任务总数："), render: (setting) => {
            const stats = this.plugin.taskService.getStats();
            setting.setDesc(`${stats.total} (${t("进行中")}: ${stats.active}, ${t("已完成")}: ${stats.completed}, ${t("回收站")}: ${stats.deleted})`);
          } },
          { name: t("清空所有任务"), desc: t("删除所有任务数据，保留列表和标签配置"), render: (setting) => {
            setting.addButton((button) => this.markDestructive(button).setButtonText(t("清空任务")).onClick(() => { runAsyncAction(this.clearTasks(), "settings interaction"); }));
          } },
          { name: t("重置所有数据"), desc: t("清空所有任务、列表、标签、分组，恢复到初始状态"), render: (setting) => {
            setting.addButton((button) => this.markDestructive(button).setButtonText(t("全部重置")).onClick(() => { runAsyncAction(this.resetData(), "settings interaction"); }));
          } },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.plugin.settings;
    switch (key) {
      case "todoFolder": return settings.todoFolder;
      case "defaultListName": return settings.defaultListName;
      case "language": return settings.language;
      case "showLunarCalendar": return settings.showLunarCalendar;
      case "showDailyRecurringInDaySchedule": return settings.showDailyRecurringInDaySchedule;
      case "showDailyRecurringInWeekSchedule": return settings.showDailyRecurringInWeekSchedule;
      case "showDailyRecurringInMonthSchedule": return settings.showDailyRecurringInMonthSchedule;
      case "logLevel": return settings.logLevel;
      default: return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings;
    if (key === "language") {
      if (value !== "zh" && value !== "en") return;
      await this.changeLanguage(value);
      return;
    }
    if (key === "logLevel") {
      if (value !== "DEBUG" && value !== "INFO" && value !== "WARN" && value !== "ERROR") return;
      settings.logLevel = value;
      logger.setLevel(LogLevel[value]);
    } else if (key === "todoFolder" || key === "defaultListName") {
      if (typeof value !== "string") return;
      settings[key] = value;
    } else if (key === "showLunarCalendar" || key === "showDailyRecurringInDaySchedule" || key === "showDailyRecurringInWeekSchedule" || key === "showDailyRecurringInMonthSchedule") {
      if (typeof value !== "boolean") return;
      settings[key] = value;
    } else {
      return;
    }
    await this.plugin.saveSettings();
  }

  private refreshSettings(): void {
    if (typeof this.update === "function") this.update();
    else this.display();
  }

  private async changeLanguage(language: TodoLanguage): Promise<void> {
    this.plugin.settings.language = language;
    setLanguage(language);
    await this.plugin.saveSettings();
    await this.plugin.refreshLanguage();
    this.refreshSettings();
  }

  private addBirthdayControl(setting: Setting): void {
    const input = setting.controlEl.createEl("input", { attr: { type: "date" } });
    input.value = this.plugin.settings.birthday || "";
    input.addEventListener("change", () => { runAsyncAction((async () => {
      this.plugin.settings.birthday = input.value;
      await this.plugin.saveSettings();
    })(), "settings interaction"); });
  }

  private openOnboarding(): void {
    new OnboardingModal(this.app, async () => {
      this.plugin.settings.onboardingCompleted = true;
      await this.plugin.saveSettings();
    }).open();
  }

  private renderTagDefinition(setting: Setting, title: string, tags: DomainTag[], editable: boolean, desc: string): void {
    setting.settingEl.addClass("todo-declarative-tag-setting");
    this.renderTagGroup(setting.settingEl, t(title), tags, editable, t(desc));
  }

  private markDestructive(button: ButtonComponent): ButtonComponent {
    if (typeof button.setDestructive === "function") return button.setDestructive();
    return button.setWarning();
  }

  private async clearTasks(): Promise<void> {
    const count = this.plugin.taskService.getStats().total;
    const confirmed = await new ConfirmModal(this.app, "即将删除 " + count + " 个任务，此操作不可撤销。确认清空吗？").openAndConfirm();
    if (!confirmed) return;
    await this.plugin.taskService.clearAll();
    this.refreshSettings();
    try { await this.plugin.refreshView(); } catch (error) { logger.error("refreshView failed:", error); }
  }

  private async resetData(): Promise<void> {
    const confirmed = await new ConfirmModal(this.app, "即将重置所有数据（任务、列表、标签、分组），此操作不可撤销。确认重置吗？").openAndConfirm();
    if (!confirmed) return;
    await this.plugin.resetAllData();
    this.refreshSettings();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // --- Header ---
    const head = containerEl.createDiv("todo-settings-head");
    head.createDiv({ cls: "todo-settings-title", text: "Plan to Day" });
    head.createDiv({ cls: "todo-settings-sub", text: t("任务管理插件设置") });

    // --- Basic Settings ---
    this.settingGroup(containerEl, t("基本设置"), t("插件核心配置"), (group) => {
      new Setting(group)
        .setName(t("数据存储文件夹"))
        .setDesc(t("任务数据文件存储在 Vault 中的文件夹路径"))
        .addText((text) =>
          text
            .setPlaceholder("todo")
            .setValue(this.plugin.settings.todoFolder)
            .onChange(async (value) => {
              this.plugin.settings.todoFolder = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(group)
        .setName(t("默认列表名称"))
        .setDesc(t("首次运行时自动创建的默认列表名称"))
        .addText((text) =>
          text
            .setPlaceholder("Tasks")
            .setValue(this.plugin.settings.defaultListName)
            .onChange(async (value) => {
              this.plugin.settings.defaultListName = value;
              await this.plugin.saveSettings();
            })
        );

      const birthdaySetting = new Setting(group)
        .setName(t("生日"))
        .setDesc(t("用于人生计划视图计算年龄（格式：YYYY-MM-DD）"));
      this.addBirthdayControl(birthdaySetting);

      new Setting(group)
        .setName(t("新手引导"))
        .setDesc(t("查看插件功能介绍"))
        .addButton((button) => button
          .setButtonText(t("重新打开新手引导"))
          .onClick(() => this.openOnboarding()));
    });

    // --- Display Settings ---
    this.settingGroup(containerEl, t("显示设置"), t("界面显示选项"), (group) => {
      new Setting(group)
        .setName(t("语言"))
        .setDesc(t("选择插件界面语言"))
        .addDropdown((dropdown) => dropdown
          .addOption("zh", t("中文"))
          .addOption("en", t("英文"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            if (value === "zh" || value === "en") await this.changeLanguage(value);
          }));

      if (!isEnglish()) {
        new Setting(group)
          .setName(t("显示农历"))
          .setDesc(t("在日历、日程视图和日期选择器中显示农历日期、节日和节气"))
          .addToggle((toggle) =>
            toggle
              .setValue(this.plugin.settings.showLunarCalendar)
              .onChange(async (value) => {
                this.plugin.settings.showLunarCalendar = value;
                await this.plugin.saveSettings();
              })
          );
      }

      new Setting(group)
        .setName(t("在日视图显示每日重复任务"))
        .setDesc(t("控制每日重复任务是否出现在日视图的日程中"))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.showDailyRecurringInDaySchedule)
          .onChange(async (value) => {
            this.plugin.settings.showDailyRecurringInDaySchedule = value;
            await this.plugin.saveSettings();
          }));

      new Setting(group)
        .setName(t("在周视图显示每日重复任务"))
        .setDesc(t("控制每日重复任务是否出现在周视图的日程中"))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.showDailyRecurringInWeekSchedule)
          .onChange(async (value) => {
            this.plugin.settings.showDailyRecurringInWeekSchedule = value;
            await this.plugin.saveSettings();
          }));

      new Setting(group)
        .setName(t("在月视图显示每日重复任务"))
        .setDesc(t("控制每日重复任务是否出现在月视图的日程中"))
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.showDailyRecurringInMonthSchedule)
          .onChange(async (value) => {
            this.plugin.settings.showDailyRecurringInMonthSchedule = value;
            await this.plugin.saveSettings();
          }));
    });

    // --- Tag Management ---
    const allTags = this.plugin.tagService.getAll();
    const quadrantTags = allTags.filter((t) => t.sortOrder < 4);
    const domainTags = allTags.filter((t) => t.sortOrder >= 4);
    const customTags = allTags.filter((t) => !t.isDefault);

    this.settingGroup(containerEl, t("标签管理"), t("任务分类与标签配置"), (group) => {
      this.renderTagGroup(group, t("四象限标签"), quadrantTags, false, t("用于四象限视图的任务分类"));
      this.renderTagGroup(group, t("领域标签"), domainTags, false, t("用于人生领域维度的任务分类"));
      this.renderTagGroup(group, t("自定义标签"), customTags, true, t("自由创建的个性化标签"));
    });

    // --- Advanced Settings ---
    this.settingGroup(containerEl, t("高级设置"), t("调试与日志"), (group) => {
      new Setting(group)
        .setName(t("日志级别"))
        .setDesc(t("控制控制台日志的详细程度"))
        .addDropdown((dropdown) =>
          dropdown
            .addOption("DEBUG", t("调试"))
            .addOption("INFO", t("信息"))
            .addOption("WARN", t("警告"))
            .addOption("ERROR", t("错误"))
            .setValue(this.plugin.settings.logLevel)
            .onChange(async (value) => {
              await this.setControlValue("logLevel", value);
            })
        );
    });

    // --- Data Management ---
    const stats = this.plugin.taskService.getStats();
    this.settingGroup(containerEl, t("数据管理"), t("备份、清空与重置"), (group) => {
      const statsEl = group.createDiv({ cls: "todo-setting-stats" });
      statsEl.createSpan({ text: `${t("任务总数：")}${stats.total} (${t("进行中")}: ${stats.active}, ${t("已完成")}: ${stats.completed}, ${t("回收站")}: ${stats.deleted})` });

      new Setting(group)
        .setName(t("清空所有任务"))
        .setDesc(t("删除所有任务数据，保留列表和标签配置"))
        .addButton((btn) =>
          this.markDestructive(btn)
            .setButtonText(t("清空任务"))
            .onClick(() => { runAsyncAction(this.clearTasks(), "settings interaction"); })
        );


      new Setting(group)
        .setName(t("重置所有数据"))
        .setDesc(t("清空所有任务、列表、标签、分组，恢复到初始状态"))
        .addButton((btn) =>
          this.markDestructive(btn)
            .setButtonText(t("全部重置"))
            .onClick(() => { runAsyncAction(this.resetData(), "settings interaction"); })
      );
    });

    // AI 规划设置暂时隐藏，保留 planningIntensity 配置字段，待 AI provider 与规则完善后重新开放。

    localizeDom(containerEl);
  }

  private settingGroup(containerEl: HTMLElement, title: string, desc: string | undefined, render: (body: HTMLElement) => void): void {
    const wrap = containerEl.createDiv("todo-setting-section");
    const head = wrap.createDiv("todo-setting-section-head");
    head.createDiv({ cls: "todo-setting-section-title", text: title });
    if (desc) head.createDiv({ cls: "todo-setting-section-desc", text: desc });
    const body = wrap.createDiv("todo-setting-section-body");
    render(body);
  }
  private renderTagGroup(container: HTMLElement, title: string, tags: { id: string; name: string; icon: string; color: string; isDefault: boolean }[], editable: boolean, desc?: string): void {
    const group = container.createDiv({ cls: "todo-setting-tag-group" + (editable ? "" : " todo-setting-tag-preset") });
    const titleRow = group.createDiv({ cls: "todo-setting-tag-title-row" });
    const titleLeft = titleRow.createDiv({ cls: "todo-setting-tag-title-left" });
    titleLeft.createSpan({ text: title, cls: "todo-setting-tag-group-title" });
    titleLeft.createSpan({ text: "(" + tags.length + ")", cls: "todo-setting-tag-group-count" });
    if (editable) {
      const addBtn = titleRow.createEl("button", { text: `+ ${t("添加")}`, cls: "todo-setting-tag-add-btn" });
      addBtn.addEventListener("click", () => {
        new TagEditModal(this.app, null, (result) => { runAsyncAction((async () => {
          await this.plugin.tagService.create({
            name: result.name,
            icon: result.icon,
            color: result.color,
            sortOrder: 100,
            isDefault: false,
          });
          this.refreshSettings();
        })(), "settings interaction"); }).open();
      });
    }
    if (desc) {
      group.createEl("p", { text: desc, cls: "todo-setting-tag-desc" });
    }

    if (tags.length === 0) {
      group.createDiv({ cls: "todo-setting-tag-empty", text: t("暂无标签") });
      return;
    }

    const grid = group.createDiv({ cls: "todo-setting-tag-grid" });
    for (const tag of tags) {
      const item = grid.createDiv({ cls: "todo-setting-tag-item" });
      const colorBar = item.createDiv({ cls: "todo-setting-tag-color-bar" });
      colorBar.style.backgroundColor = tag.color || "var(--text-muted)";
      const left = item.createDiv({ cls: "todo-setting-tag-left" });
      const iconEl = left.createSpan({ cls: "todo-setting-tag-icon" });
      setIcon(iconEl, tag.icon);
      left.createSpan({ cls: "todo-setting-tag-name", text: systemTagName(tag) });

      if (editable) {
        const actions = item.createDiv({ cls: "todo-setting-tag-actions" });
        const editBtn = actions.createEl("button", { text: t("编辑"), cls: "todo-setting-tag-btn" });
        editBtn.addEventListener("click", () => {
          new TagEditModal(this.app, tag, (result) => { runAsyncAction((async () => {
            await this.plugin.tagService.update(tag.id, {
              name: result.name,
              icon: result.icon,
              color: result.color,
            });
            this.refreshSettings();
          })(), "settings interaction"); }).open();
        });
        const delBtn = actions.createEl("button", { text: t("删除"), cls: "todo-setting-tag-btn mod-warning" });
        delBtn.addEventListener("click", () => { runAsyncAction((async () => {
          const confirmed = await new ConfirmModal(this.app, "确定删除标签「" + tag.name + "」吗？").openAndConfirm();
          if (confirmed) {
            await this.plugin.tagService.delete(tag.id);
            this.refreshSettings();
          }
        })(), "settings interaction"); });
      }
    }
  }

}

interface TagEditResult {
  name: string;
  icon: string;
  color: string;
}


class ConfirmModal extends Modal {
  private message: string;
  private resolve!: (value: boolean) => void;
  constructor(app: App, message: string) {
    super(app);
    this.message = t(message);
  }
  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const actions = this.contentEl.createDiv({ cls: "todo-prompt-actions" });
    actions.createEl("button", { text: t("取消") }).addEventListener("click", () => { this.resolve(false); this.close(); });
    actions.createEl("button", { text: t("确认"), cls: "mod-cta" }).addEventListener("click", () => { this.resolve(true); this.close(); });
  }
  onClose(): void { this.contentEl.empty(); }
  openAndConfirm(): Promise<boolean> {
    return new Promise<boolean>((resolve) => { this.resolve = resolve; this.open(); });
  }
}

class TagEditModal extends Modal {
  private tag: { name: string; icon: string; color: string } | null;
  private onSave: (result: TagEditResult) => void;
  private nameInput!: HTMLInputElement;
  private selectedIcon: string;
  private colorInput!: HTMLInputElement;

  constructor(app: App, tag: { name: string; icon: string; color: string } | null, onSave: (result: TagEditResult) => void) {
    super(app);
    this.tag = tag;
    this.onSave = onSave;
    this.selectedIcon = tag?.icon || "tag";
  }

  onOpen(): void {
    this.contentEl.addClass("todo-tag-edit-modal");
    this.contentEl.createDiv({ cls: "todo-tag-edit-title", text: this.tag ? t("编辑标签") : t("新增标签") });

    // Name
    const nameRow = this.contentEl.createDiv({ cls: "todo-tag-edit-row" });
    nameRow.createEl("label", { text: t("名称") });
    this.nameInput = nameRow.createEl("input", { attr: { type: "text", placeholder: t("标签名称") } });
    this.nameInput.value = this.tag?.name || "";

    // Icon
    const iconGroup = this.contentEl.createDiv({ cls: "todo-tag-edit-row" });
    iconGroup.createEl("label", { text: t("图标") });
    
    // Current icon preview
    const iconPreview = iconGroup.createDiv({ cls: "todo-tag-edit-icon-preview" });
    const iconDisplay = iconPreview.createSpan({ cls: "todo-tag-edit-icon-display" });
    setIcon(iconDisplay, this.selectedIcon);
    const iconNameDisplay = iconPreview.createSpan({ cls: "todo-tag-edit-icon-name", text: this.selectedIcon });

    // Icon grid
    const gridEl = iconGroup.createDiv({ cls: "todo-tag-edit-icon-grid" });

    for (const iconName of ICON_OPTIONS) {
      const item = gridEl.createDiv({
        cls: "todo-tag-edit-icon-item" + (iconName === this.selectedIcon ? " selected" : ""),
      });
      item.title = iconName;
      setIcon(item, iconName);
      item.addEventListener("click", () => {
        this.selectedIcon = iconName;
        setIcon(iconDisplay, iconName);
        iconNameDisplay.setText(iconName);
        gridEl.querySelectorAll(".todo-tag-edit-icon-item").forEach((el) => el.removeClass("selected"));
        item.addClass("selected");
      });
    }

    // Color
    const colorRow = this.contentEl.createDiv({ cls: "todo-tag-edit-row" });
    colorRow.createEl("label", { text: t("颜色") });
    this.colorInput = colorRow.createEl("input", { attr: { type: "color" } });
    this.colorInput.value = this.tag?.color || "#6B7280";

    // Actions
    const actions = this.contentEl.createDiv({ cls: "todo-tag-edit-actions" });
    actions.createEl("button", { text: t("取消") }).addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", { text: t("保存"), cls: "mod-cta" });
    saveBtn.addEventListener("click", () => {
      const name = this.nameInput.value.trim();
      if (!name) return;
      this.onSave({ name, icon: this.selectedIcon, color: this.colorInput.value });
      this.close();
    });

    window.setTimeout(() => this.nameInput.focus(), 30);
  }

  onClose(): void { this.contentEl.empty(); }
}
