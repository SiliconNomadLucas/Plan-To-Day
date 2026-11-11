import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "../src/models/Task";
import type { TodoPluginLike } from "../src/views/TodoView";
import { GoalDashboardRenderer } from "../src/views/GoalDashboardRenderer";
import { LifePlanRenderer } from "../src/views/LifePlanRenderer";
import { PlanGroupRenderer } from "../src/views/PlanGroupRenderer";
import { Menu, TestElement } from "./mocks/obsidian";

function byClass(root: TestElement, name: string): TestElement {
  const match = root.find((element) => element.className.split(/\s+/).includes(name));
  if (!match) throw new Error(`Missing ${name}`);
  return match;
}

describe("plan renderers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 11, 12));
    vi.stubGlobal("HTMLElement", TestElement);
    vi.stubGlobal("document", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("window", { innerWidth: 1200, innerHeight: 800, setTimeout: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps life goals in age and unassigned groups with working card actions", async () => {
    const goal = createTask({ id: "age-goal", planKind: "life", planPeriodKey: "26", title: "Learn" });
    const undated = createTask({ id: "undated", planKind: "life", title: "Explore" });
    const openTask = vi.fn(async () => undefined);
    const toggleCompletion = vi.fn(async (task) => { task.isCompleted = !task.isCompleted; });
    const renderer = new LifePlanRenderer({
      getTasks: () => [goal, undated],
      getTags: () => [],
      toggleCompletion,
      openTask,
    });
    const root = new TestElement();

    await renderer.render(root as unknown as HTMLDivElement, "2000-01-01");

    expect(root.className.split(/\s+/)).toContain("todo-life-active");
    expect(root.find((element) => element.getAttribute("data-age-key") === "26")).toBeDefined();
    expect(byClass(root, "todo-life-age-na").textContent).toBe("未设定年龄");
    const card = root.find((element) => element.getAttribute("data-task-id") === "age-goal")!;
    await byClass(card, "todo-checkbox").triggerAsync("click");
    expect(toggleCompletion).toHaveBeenCalledWith(goal);
    expect(byClass(root.find((element) => element.getAttribute("data-task-id") === "age-goal")!, "todo-checkbox")
      .className.split(/\s+/)).toContain("checked");

    await root.find((element) => element.getAttribute("data-task-id") === "undated")!.triggerAsync("click");
    expect(openTask).toHaveBeenCalledWith("undated");
  });

  it("renders year goal cards, lazily expands KR rows, and cleans up keyboard navigation", async () => {
    const goal = createTask({
      id: "year-goal",
      title: "Ship",
      planKind: "year",
      planPeriodKey: "2026",
    });
    const child = createTask({
      id: "kr",
      title: "Milestone",
      parentId: goal.id,
      planKind: "quarter",
      planPeriodKey: "2026-Q4",
    });
    const tasks = [goal, child];
    const service = {
      getAll: () => tasks,
      getChildrenOf: (parentId: string) => tasks.filter((task) => task.parentId === parentId),
      getParentOf: () => undefined,
      getByPlanKindAndPeriod: (kind: string, periodKey: string) =>
        tasks.filter((task) => task.planKind === kind && task.planPeriodKey === periodKey),
      create: vi.fn(async (fields: Partial<Task>) => createTask(fields)),
      complete: vi.fn(async (id: string) => {
        const task = tasks.find((item) => item.id === id)!;
        task.isCompleted = true;
        return task;
      }),
      uncomplete: vi.fn(async (id: string) => {
        const task = tasks.find((item) => item.id === id)!;
        task.isCompleted = false;
        return task;
      }),
    };
    const plugin = {
      taskService: service,
      tagService: { getAll: () => [] },
      settings: { activeViewNav: "plan", goalViewMode: "card" },
      saveSettings: vi.fn(async () => undefined),
    } as unknown as TodoPluginLike;
    const root = new TestElement();
    const quick = new TestElement();
    const openTask = vi.fn(async () => undefined);
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.stubGlobal("document", { addEventListener: addListener, removeEventListener: removeListener });
    const planGroups = new PlanGroupRenderer(service, {
      renderTaskRow: () => undefined,
      isMobile: () => false,
      promptPlanCreate: async () => undefined,
      onTaskCreated: async () => undefined,
    });
    const renderer = new GoalDashboardRenderer(plugin, planGroups, {
      getTaskListEl: () => root as unknown as HTMLDivElement,
      getQuickContainerEl: () => quick as unknown as HTMLDivElement,
      getActivePlanKind: () => "year",
      isMobile: () => false,
      openTask,
      promptPlanCreate: async () => undefined,
      getWeekPlanMoveOptions: () => [],
      refreshLists: async () => undefined,
      confirmQuarterGoal: async () => true,
    });

    await renderer.renderGoalDashboard("year");

    expect(renderer.periodKey).toBe("2026");
    const card = root.find((element) => element.getAttribute("data-goal-id") === goal.id)!;
    byClass(card, "todo-goal-expand-btn").trigger("click");
    const kr = byClass(card, "todo-goal-kr-item");
    expect(byClass(kr, "todo-goal-kr-title").textContent).toBe("Milestone");
    await byClass(kr, "todo-checkbox").triggerAsync("click");
    expect(child.isCompleted).toBe(true);
    expect(byClass(card, "todo-goal-metric-item").textContent).toBe("KR 1/1");
    await card.triggerAsync("click");
    expect(openTask).toHaveBeenCalledWith("year-goal");

    renderer.dispose();
    expect(addListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("creates a linked monthly goal when a quarter goal is dropped on the drop zone", async () => {
    const quarterGoal = createTask({
      id: "quarter-goal",
      title: "Improve health",
      planKind: "quarter",
      planPeriodKey: "2026-Q4",
      tags: ["health"],
      isImportant: true,
    });
    const tasks = [quarterGoal];
    const created: Array<Partial<Task>> = [];
    const service = {
      getAll: () => tasks,
      getChildrenOf: (parentId: string) => tasks.filter((task) => task.parentId === parentId),
      getParentOf: () => undefined,
      getByPlanKindAndPeriod: (kind: string, periodKey: string) =>
        tasks.filter((task) => task.planKind === kind && task.planPeriodKey === periodKey),
      create: vi.fn(async (fields: Partial<Task>) => {
        created.push(fields);
        return createTask(fields);
      }),
      update: vi.fn(async () => undefined),
    };
    const plugin = {
      taskService: service,
      tagService: { getAll: () => [] },
      settings: { activeViewNav: "plan", goalViewMode: "card" },
      saveSettings: vi.fn(async () => undefined),
    } as unknown as TodoPluginLike;
    const root = new TestElement();
    const renderer = new GoalDashboardRenderer(plugin, new PlanGroupRenderer(service, {
      renderTaskRow: () => undefined,
      isMobile: () => false,
      promptPlanCreate: async () => undefined,
      onTaskCreated: async () => undefined,
    }), {
      getTaskListEl: () => root as unknown as HTMLDivElement,
      getQuickContainerEl: () => new TestElement() as unknown as HTMLDivElement,
      getActivePlanKind: () => "month",
      isMobile: () => false,
      openTask: async () => undefined,
      promptPlanCreate: async () => undefined,
      getWeekPlanMoveOptions: () => [],
      refreshLists: async () => undefined,
      confirmQuarterGoal: async () => true,
    });
    const getData = vi.fn((key: string) => key === "text/plain" ? "quarter-goal" : "");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const currentMonth = new Date().getMonth() + 1;
    const currentKey = `2026-${String(currentMonth).padStart(2, "0")}`;

    await renderer.renderGoalDashboard("month");

    const dropZone = root.find((element) => element.className.includes("todo-quarter-goal-drop-zone"))!;
    await dropZone.triggerAsync("drop", {
      target: dropZone,
      dataTransfer: { getData: getData, dropEffect: "" },
      preventDefault,
      stopPropagation,
    });
    expect(getData).toHaveBeenCalledWith("text/plain");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(created).toEqual([{
      title: "Improve health",
      planKind: "month",
      planPeriodKey: currentKey,
      parentId: "quarter-goal",
      tags: ["health"],
      isImportant: true,
    }]);
  });

  it("offers quarter-contained months in the goal period move menu", async () => {
    const monthGoal = createTask({
      id: "month-goal",
      title: "Goal",
      planKind: "month",
      planPeriodKey: "2026-10",
      parentId: "quarter-goal",
    });
    const quarterGoal = createTask({
      id: "quarter-goal",
      planKind: "quarter",
      planPeriodKey: "2026-Q4",
    });
    const service = {
      getAll: () => [monthGoal, quarterGoal],
      getChildrenOf: () => [],
      getParentOf: (id: string) => id === monthGoal.id ? quarterGoal : undefined,
      getByPlanKindAndPeriod: () => [],
      create: vi.fn(async (fields: Partial<Task>) => createTask(fields)),
      update: vi.fn(async () => undefined),
    };
    const plugin = {
      taskService: service,
      tagService: { getAll: () => [] },
      settings: { activeViewNav: "plan", goalViewMode: "card" },
      saveSettings: vi.fn(async () => undefined),
    } as unknown as TodoPluginLike;
    const root = new TestElement();
    const renderer = new GoalDashboardRenderer(plugin, new PlanGroupRenderer(service, {
      renderTaskRow: () => undefined,
      isMobile: () => false,
      promptPlanCreate: async () => undefined,
      onTaskCreated: async () => undefined,
    }), {
      getTaskListEl: () => root as unknown as HTMLDivElement,
      getQuickContainerEl: () => new TestElement() as unknown as HTMLDivElement,
      getActivePlanKind: () => "month",
      isMobile: () => false,
      openTask: async () => undefined,
      promptPlanCreate: async () => undefined,
      getWeekPlanMoveOptions: () => [],
      refreshLists: async () => undefined,
      confirmQuarterGoal: async () => true,
    });
    renderer.periodKey = "2026-10";
    Menu.instances = [];

    await renderer.renderGoalDashboard("month");
    const card = root.find((element) => element.getAttribute("data-goal-id") === monthGoal.id)!;
    await card.triggerAsync("contextmenu", {
      target: card,
      clientX: 10,
      clientY: 20,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    Menu.instances.at(-1)?.items.find((item) => item.title === "移动到周期...")?.trigger();
    const menuItem = Menu.instances.at(-1)?.items.find((item) => item.title === "2026.12 月度计划");
    expect(menuItem).toBeDefined();
    await menuItem?.trigger();
    expect(service.update).toHaveBeenCalledWith(monthGoal.id, { planPeriodKey: "2026-12" });
  });
});
