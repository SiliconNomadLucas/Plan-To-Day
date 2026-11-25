import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestElement } from "./mocks/obsidian";
import { createTask, type Task } from "../src/models/Task";
import { DEFAULT_SETTINGS } from "../src/settings";
import { TodoView, type TodoPluginLike, type ViewNav } from "../src/views/TodoView";
import { TaskDetailView } from "../src/views/TaskDetailView";
import { setLanguage } from "../src/i18n";
import type ObsidianTodoPlugin from "../main";
import { TodoNavView } from "../src/views/TodoNavView";
import { SYNC_DATA_FILES } from "../src/models/SyncDataFile";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(nav: ViewNav = "all") {
  let tasks: Task[] = [];
  const settings = { ...DEFAULT_SETTINGS, activeViewNav: nav, taskFilterStatus: "all" as const };
  const list = { id: "work", name: "Work", isDefault: false, icon: "list", tags: [], groupId: null };
  const taskService = {
    getAll: () => tasks.filter((task) => !task.isDeleted && !task.isRecurrenceTemplate),
    getAllIncludingDeleted: () => tasks,
    getByListId: (id: string) => tasks.filter((task) => task.listId === id),
    getInbox: (id: string) => tasks.filter((task) => task.listId === id),
    getChildrenOf: (id: string) => tasks.filter((task) => task.parentId === id),
    getParentOf: () => undefined,
    getByPlanKindAndPeriod: () => [],
    getDeleted: () => tasks.filter((task) => task.isDeleted),
    update: vi.fn(async (id: string, changes: Partial<Task>) => {
      const task = tasks.find((item) => item.id === id);
      if (!task) return null;
      Object.assign(task, changes);
      return task;
    }),
  };
  const plugin = {
    settings, taskService,
    listService: { getById: (id: string) => id === list.id ? list : undefined, getActive: () => [list], getDefault: () => list },
    tagService: { getAll: () => [], getById: () => undefined },
    groupService: { getAll: () => [] },
    saveSettings: vi.fn(async () => undefined),
  };
  const view = new TodoView({} as never, plugin as unknown as TodoPluginLike);
  const root = Reflect.get(view, "containerEl") as unknown as TestElement;
  const layout = root.createDiv({ cls: "todo-layout" });
  const taskList = layout.createDiv({ cls: "todo-task-list" });
  const quick = layout.createDiv();
  const quickInput = quick.createEl("input");
  const detailRoot = layout.createDiv();
  const closed = vi.fn(() => layout.removeClass("todo-layout-detail-open"));
  const detail = new TaskDetailView({} as never, plugin as unknown as TodoPluginLike, detailRoot as unknown as HTMLElement,
    undefined, closed);
  const renderRow = vi.fn((container: TestElement, task: Task) => {
    container.createDiv({ text: task.title, cls: "todo-task-item", attr: { "data-task-id": task.id } });
  });
  const renderLists = vi.fn(async () => undefined);
  for (const [key, value] of Object.entries({
    externalRefreshReady: true, taskListEl: taskList, quickContainerEl: quick, quickInputEl: quickInput,
    detailView: detail, detailEl: detailRoot, layoutEl: layout,
    sortBtnEl: new TestElement(), renderTaskRow: renderRow, renderLists,
  })) Reflect.set(view, key, value);
  return { view, root, layout, taskList, quick, quickInput, detailRoot, detail, closed, plugin, renderRow, renderLists,
    setTasks(next: Task[]) { tasks = next; } };
}

describe("external view refresh", () => {
  let taskDocument: { activeElement: TestElement | null; querySelector: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setLanguage("zh");
    taskDocument = { activeElement: null, querySelector: vi.fn(() => null), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("document", Object.assign(taskDocument, { body: new TestElement() }));
    vi.stubGlobal("HTMLElement", TestElement);
    vi.stubGlobal("window", { innerWidth: 1200, setTimeout: vi.fn(), clearInterval: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("renders synced task data while keeping list selection, quick draft, scroll and task highlight", async () => {
    const h = harness();
    const task = createTask({ id: "selected", title: "Remote title", listId: "work" });
    h.setTasks([task]);
    h.plugin.settings.selectedListId = "work";
    h.plugin.settings.selectedTaskId = task.id;
    h.quickInput.value = "Unsubmitted quick task";
    taskDocument.activeElement = h.quickInput;
    h.taskList.scrollTop = 280;

    await expect(h.view.refreshFromExternalChange()).resolves.toBe(true);

    expect(h.renderRow).toHaveBeenCalledOnce();
    expect(h.renderRow.mock.calls[0][0] === h.taskList).toBe(true);
    expect(h.renderRow.mock.calls[0][1].title).toBe("Remote title");
    expect(Reflect.get(h.renderRow.mock.calls[0], "2")).toBe("list");
    expect(h.plugin.settings.selectedListId).toBe("work");
    expect(h.plugin.settings.selectedTaskId).toBe(task.id);
    expect(h.quickInput.value).toBe("Unsubmitted quick task");
    expect(taskDocument.activeElement).toBe(h.quickInput);
    expect(h.taskList.scrollTop).toBe(280);
    expect(h.taskList.querySelector(".todo-task-selected")?.textContent).toBe("Remote title");
    expect(h.plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("restores a valid selected list when the persisted navigation is all tasks", async () => {
    const h = harness("all");
    h.setTasks([createTask({ title: "In selected list", listId: "work" })]);
    h.plugin.settings.selectedListId = "work";
    await Reflect.get(h.view, "restoreNavigation").call(h.view);
    expect(h.renderRow).toHaveBeenCalledOnce();
    expect(h.renderRow.mock.calls[0][1].listId).toBe("work");
    expect(h.plugin.settings.selectedListId).toBe("work");
  });

  it("restores the selected quadrant instead of normalizing it to all tasks", async () => {
    const h = harness("all");
    h.plugin.settings.selectedQuadrant = "重要紧急";
    const quadrantGroup = new TestElement();
    const selected = quadrantGroup.createDiv({ cls: "todo-nav-item todo-quadrant-item", attr: { "data-quadrant": "重要紧急" } });
    const other = quadrantGroup.createDiv({ cls: "todo-nav-item todo-quadrant-item", attr: { "data-quadrant": "重要不紧急" } });
    Reflect.set(h.view, "quadrantGroupEl", quadrantGroup);
    const renderTasks = vi.fn(async () => undefined);
    Reflect.set(h.view, "renderTasks", renderTasks);

    await Reflect.get(h.view, "restoreNavigation").call(h.view);

    expect(h.plugin.settings.selectedQuadrant).toBe("重要紧急");
    expect(renderTasks).toHaveBeenCalledWith("all");
    expect(selected.hasClass("active")).toBe(true);
    expect(other.hasClass("active")).toBe(false);
  });

  it("clears the selected list on an ordinary all-tasks navigation", async () => {
    const h = harness();
    h.plugin.settings.selectedListId = "work";
    h.plugin.settings.selectedQuadrant = "重要紧急";
    h.setTasks([
      createTask({ id: "work-task", title: "Work", listId: "work" }),
      createTask({ id: "other-task", title: "Other", listId: "other" }),
    ]);
    await h.view.activateNavFromExternal("all");
    expect(h.plugin.settings.selectedListId).toBeNull();
    expect(h.plugin.settings.selectedQuadrant).toBeNull();
    expect(h.renderRow.mock.calls.map((call) => call[1].id)).toEqual(["work-task", "other-task"]);
  });

  it("clears list selection before persisting a quadrant selection", async () => {
    const h = harness();
    h.plugin.settings.selectedListId = "work";
    let saved: { selectedListId: string | null; selectedQuadrant: string | null; activeViewNav: ViewNav } | null = null;
    h.plugin.saveSettings.mockImplementation(async () => {
      saved = {
        selectedListId: h.plugin.settings.selectedListId,
        selectedQuadrant: h.plugin.settings.selectedQuadrant,
        activeViewNav: h.plugin.settings.activeViewNav,
      };
    });

    await Reflect.get(h.view, "selectQuadrant").call(h.view, "重要紧急");

    expect(saved).toEqual({
      selectedListId: null,
      selectedQuadrant: "重要紧急",
      activeViewNav: "all",
    });
  });

  it("falls back to all tasks and clears a missing list during navigation restore", async () => {
    const h = harness("all");
    h.plugin.settings.selectedListId = "removed-list";
    const activateNav = vi.spyOn(h.view, "activateNavFromExternal");
    await Reflect.get(h.view, "restoreNavigation").call(h.view);
    expect(h.plugin.settings.selectedListId).toBeNull();
    expect(h.plugin.settings.activeViewNav).toBe("all");
    expect(activateNav).not.toHaveBeenCalled();
    expect(h.renderRow).not.toHaveBeenCalled();
  });

  it("keeps the selected My Day date and derives its time groups without writing to the service", async () => {
    const h = harness("myday");
    Reflect.set(h.view, "myDayViewDate", "2026-11-20");
    const task = createTask({ id: "scheduled", title: "Afternoon", myDayGroup: "morning",
      startDate: "2026-11-20T14:00:00", dueDate: "2026-11-20T15:00:00" });
    h.setTasks([task, createTask({ title: "Different day", dueDate: "2026-11-21T10:00:00" })]);

    await h.view.refreshFromExternalChange();

    expect(Reflect.get(h.view, "myDayViewDate")).toBe("2026-11-20");
    expect(h.renderRow).toHaveBeenCalledTimes(1);
    const rowContainer = h.renderRow.mock.calls[0][0];
    expect(rowContainer.parentElement?.querySelector(".todo-myday-group-header")?.children[0].textContent).toBe("下午");
    expect(task.myDayGroup).toBe("morning");
    expect(h.plugin.taskService.update).not.toHaveBeenCalled();
  });

  it.each(["schedule", "review", "trash"] as const)("refreshes %s without resetting date or showing quick input", async (nav) => {
    const h = harness(nav);
    h.quick.addClass("todo-is-hidden");
    Reflect.set(h.view, "scheduleYear", 2027);
    Reflect.set(h.view, "scheduleMonth", 5);
    Reflect.set(h.view, "scheduleDate", 12);
    Reflect.set(h.view, "reviewYear", 2025);
    Reflect.set(h.view, "reviewMonth", 3);
    Reflect.set(h.view, "reviewDate", 9);
    Reflect.set(h.view, "reviewMode", "week");
    const selector = nav === "schedule" ? ".todo-time-grid" : ".todo-review-content";
    const old = h.taskList.createDiv({ cls: selector.slice(1) });
    old.scrollTop = 330;
    const render = vi.fn(() => {
      h.taskList.empty();
      h.taskList.createDiv({ cls: selector.slice(1) });
    });
    Reflect.set(h.view, nav === "schedule" ? "renderScheduleView" : nav === "review" ? "renderReviewView" : "renderTrashView", render);

    await h.view.refreshFromExternalChange();

    expect(render).toHaveBeenCalledOnce();
    expect(h.quick.hasClass("todo-is-hidden")).toBe(true);
    expect(Reflect.get(h.view, "scheduleYear")).toBe(2027);
    expect(Reflect.get(h.view, "scheduleDate")).toBe(12);
    expect(Reflect.get(h.view, "reviewYear")).toBe(2025);
    expect(Reflect.get(h.view, "reviewMode")).toBe("week");
    expect(h.taskList.querySelector(selector)?.scrollTop).toBe(330);
    if (nav === "schedule") expect(Reflect.get(h.view, "scheduleScrollTarget")).toBe("preserve");
  });

  it.each(["year", "month"])("refreshes a %s goal dashboard through its existing period/scroll preservation", async (kind) => {
    const h = harness("plan");
    Reflect.set(h.view, "activePlanKind", kind);
    const render = vi.fn(async () => undefined);
    Reflect.set(h.view, "renderGoalDashboard", render);
    await h.view.refreshFromExternalChange();
    expect(render).toHaveBeenCalledWith(kind, true);
    expect(Reflect.get(h.view, "activePlanKind")).toBe(kind);
  });

  it("retains expanded plan period groups and their arrow state", async () => {
    const h = harness("plan");
    Reflect.set(h.view, "activePlanKind", "week");
    const group = h.taskList.createDiv();
    group.createSpan({ cls: "todo-plan-group-arrow" });
    const body = group.createDiv({ cls: "todo-plan-group-body" });
    body.dataset.periodKey = "2025-W01";
    Reflect.set(h.view, "renderPlanView", vi.fn(async () => {
      h.taskList.empty();
      const next = h.taskList.createDiv();
      next.createSpan({ cls: "todo-plan-group-arrow collapsed" });
      next.createDiv({ cls: "todo-plan-group-body todo-is-hidden", attr: { "data-period-key": "2025-W01" } });
    }));

    await h.view.refreshFromExternalChange();
    expect(h.taskList.querySelector(".todo-plan-group-body")?.hasClass("todo-is-hidden")).toBe(false);
    expect(h.taskList.querySelector(".todo-plan-group-arrow")?.hasClass("collapsed")).toBe(false);
  });

  it("refreshes an existing mobile schedule summary without opening a closed sidebar", async () => {
    const h = harness("schedule");
    Reflect.set(h.view, "isMobileEnvironment", () => true);
    Reflect.set(h.view, "renderScheduleView", () => undefined);
    const update = vi.fn();
    Reflect.set(h.view, "openScheduleSidebar", update);

    await h.view.refreshFromExternalChange();
    expect(update).not.toHaveBeenCalled();
    Reflect.set(h.view, "scheduleSidebarOpen", true);
    await h.view.refreshFromExternalChange();
    expect(update).toHaveBeenCalledWith(true);
  });

  it("defers focused edits, modals and drags while allowing an unrelated quick input draft", () => {
    const h = harness();
    expect(h.view.canRefreshFromExternalChange()).toBe(true);
    taskDocument.activeElement = h.detailRoot.createEl("textarea");
    expect(h.view.canRefreshFromExternalChange()).toBe(false);
    taskDocument.activeElement = h.quickInput;
    expect(h.view.canRefreshFromExternalChange()).toBe(true);
    taskDocument.querySelector.mockReturnValue({} as never);
    expect(h.view.canRefreshFromExternalChange()).toBe(false);
    taskDocument.querySelector.mockReturnValue(null);
    const dragging = h.taskList.createDiv({ cls: "dragging" });
    expect(h.view.canRefreshFromExternalChange()).toBe(false);
    dragging.remove();
    Reflect.set(h.view, "dragState", {});
    expect(h.view.canRefreshFromExternalChange()).toBe(false);
  });

  it("defers unready views and ignores closed views", async () => {
    const h = harness();
    Reflect.set(h.view, "externalRefreshReady", false);
    await expect(h.view.refreshFromExternalChange()).resolves.toBe(false);
    Reflect.set(h.view, "viewClosed", true);
    await expect(h.view.refreshFromExternalChange()).resolves.toBe(true);
    expect(h.renderLists).not.toHaveBeenCalled();
  });

  it("falls back from a deleted list and clears a remotely deleted task selection", async () => {
    const h = harness();
    h.plugin.settings.selectedListId = "removed-list";
    h.plugin.settings.selectedTaskId = "removed-task";
    h.setTasks([createTask({ title: "Remaining" })]);
    await h.view.refreshFromExternalChange();
    expect(h.plugin.settings.selectedListId).toBeNull();
    expect(h.plugin.settings.selectedTaskId).toBeNull();
    expect(h.renderRow).toHaveBeenCalledOnce();
  });

  it("rebuilds detail event bindings for synced data without opening the sidebar", async () => {
    const h = harness();
    const old = createTask({ id: "task", title: "Old title", note: "Old note" });
    h.setTasks([old]);
    h.detail.open(old.id);
    h.plugin.settings.selectedTaskId = old.id;
    const synced = { ...old, title: "Synced title", note: "Synced note" };
    h.setTasks([synced]);
    h.detailRoot.scrollTop = 170;

    await h.view.refreshFromExternalChange();

    const title = h.detailRoot.querySelector(".todo-detail-title-input")!;
    expect(title.value).toBe("Synced title");
    expect(h.detailRoot.querySelector(".todo-detail-textarea")?.value).toBe("Synced note");
    expect(h.detailRoot.scrollTop).toBe(170);
    title.trigger("blur");
    expect(h.plugin.taskService.update).not.toHaveBeenCalled();
    expect(h.closed).not.toHaveBeenCalled();
    expect(h.plugin.settings.selectedTaskId).toBe(old.id);
  });

  it("preserves an unfocused draft and blocks painting until its save completes", async () => {
    const h = harness();
    const task = createTask({ id: "task", title: "Original" });
    h.setTasks([task]);
    h.detail.open(task.id);
    const title = h.detailRoot.querySelector(".todo-detail-title-input")!;
    title.value = "Unsaved title";
    expect(h.detail.hasPendingEdits()).toBe(true);
    await expect(h.view.refreshFromExternalChange()).resolves.toBe(false);
    expect(title.value).toBe("Unsaved title");

    const save = deferred<Task>();
    h.plugin.taskService.update.mockImplementationOnce(() => save.promise);
    title.trigger("blur");
    expect(h.detail.hasPendingEdits()).toBe(true);
    const pendingSave = Reflect.get(h.detail, "pendingSave");
    save.resolve({ ...task, title: "Unsaved title" });
    await pendingSave;
    expect(h.detail.hasPendingEdits()).toBe(false);
  });

  it("closes the detail panel when the selected task has been remotely deleted", async () => {
    const h = harness();
    const task = createTask({ title: "Removed" });
    h.setTasks([task]);
    h.detail.open(task.id);
    h.plugin.settings.selectedTaskId = task.id;
    h.layout.addClass("todo-layout-detail-open");
    h.setTasks([]);

    await h.view.refreshFromExternalChange();

    expect(h.detail.isActive()).toBe(false);
    expect(h.closed).toHaveBeenCalledOnce();
    expect(h.plugin.settings.selectedTaskId).toBeNull();
    expect(h.layout.hasClass("todo-layout-detail-open")).toBe(false);
  });

  it("keeps a note draft started while the title save was still pending", async () => {
    const h = harness();
    const task = createTask({ title: "Original", note: "Before" });
    h.setTasks([task]);
    h.detail.open(task.id);
    const title = h.detailRoot.querySelector(".todo-detail-title-input")!;
    const note = h.detailRoot.querySelector(".todo-detail-textarea")!;
    const save = deferred<Task>();
    h.plugin.taskService.update.mockImplementationOnce(() => save.promise);
    title.value = "Saved title";
    title.trigger("blur");
    const pending = Reflect.get(h.detail, "pendingSave");
    note.value = "New draft typed during save";
    save.resolve({ ...task, title: "Saved title" });
    await pending;

    expect(note.value).toBe("New draft typed during save");
    expect(h.detail.hasPendingEdits()).toBe(true);
    await expect(h.view.refreshFromExternalChange()).resolves.toBe(false);
  });

  it("restores the goal list's scrolling even when its renderer resets the content", async () => {
    const h = harness("plan");
    Reflect.set(h.view, "activePlanKind", "month");
    h.taskList.createDiv({ cls: "todo-goal-scroll-content" }).scrollTop = 490;
    Reflect.set(h.view, "renderGoalDashboard", async () => {
      h.taskList.empty();
      h.taskList.createDiv({ cls: "todo-goal-scroll-content" });
    });
    await h.view.refreshFromExternalChange();
    expect(h.taskList.querySelector(".todo-goal-scroll-content")?.scrollTop).toBe(490);
  });

  it("updates every open main view and the mobile navigation using the plugin sync callback", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const first = harness();
    const second = harness();
    const nav = new TodoNavView({} as never, first.plugin as never);
    const renderNav = vi.spyOn(nav, "renderNav").mockResolvedValue(undefined);
    const refreshFirst = vi.spyOn(first.view, "refreshFromExternalChange");
    const refreshSecond = vi.spyOn(second.view, "refreshFromExternalChange");
    const app = { workspace: { getLeavesOfType: (type: string) => type === "plan-to-day-view"
      ? [{ view: first.view }, { view: second.view }] : [{ view: nav }] } };
    const plugin = new PluginClass(app as never, {} as never);

    await expect(Reflect.get(plugin, "refreshSyncedViews").call(plugin)).resolves.toBe(true);

    expect(refreshFirst).toHaveBeenCalledOnce();
    expect(refreshSecond).toHaveBeenCalledOnce();
    expect(renderNav).toHaveBeenCalledOnce();
    Reflect.set(second.view, "dragState", {});
    await expect(Reflect.get(plugin, "refreshSyncedViews").call(plugin)).resolves.toBe(false);
    expect(refreshFirst).toHaveBeenCalledOnce();
  });

  it("reloads associated stores in dependency order and retries only incomplete files", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const plugin = new PluginClass({} as never, {} as never);
    const order: string[] = [];
    for (const [key, name, status] of [
      ["recurrenceSeriesService", "series", "reloaded"],
      ["tagService", "tags", "unchanged"],
      ["groupService", "groups", "reloaded"],
      ["listService", "lists", "missing"],
      ["taskService", "tasks", "reloaded"],
    ] as const) {
      Reflect.set(plugin, key, { reloadFromDisk: vi.fn(async () => {
        order.push(name);
        return { status };
      }) });
    }

    const result = await Reflect.get(plugin, "reloadSyncedData").call(plugin, SYNC_DATA_FILES);

    expect(order).toEqual(["series", "tags", "groups", "lists", "tasks"]);
    expect(result).toEqual({ status: "reloaded", retryFiles: ["lists.json"] });
  });

  it("isolates an associated-file parse error and still reloads later dependencies", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const plugin = new PluginClass({} as never, {} as never);
    const order: string[] = [];
    Reflect.set(plugin, "recurrenceSeriesService", {
      reloadFromDisk: vi.fn(async () => { order.push("series"); return { status: "reloaded" }; }),
    });
    Reflect.set(plugin, "tagService", {
      reloadFromDisk: vi.fn(async () => { order.push("tags"); throw new Error("partial tags JSON"); }),
    });
    Reflect.set(plugin, "groupService", {
      reloadFromDisk: vi.fn(async () => { order.push("groups"); return { status: "unchanged" }; }),
    });
    Reflect.set(plugin, "listService", {
      reloadFromDisk: vi.fn(async () => { order.push("lists"); return { status: "unchanged" }; }),
    });
    Reflect.set(plugin, "taskService", {
      reloadFromDisk: vi.fn(async () => { order.push("tasks"); return { status: "reloaded" }; }),
    });

    const result = await Reflect.get(plugin, "reloadSyncedData").call(plugin, SYNC_DATA_FILES);

    expect(order).toEqual(["series", "tags", "groups", "lists", "tasks"]);
    expect(result).toEqual({ status: "reloaded", retryFiles: ["tags.json"] });
  });
});
