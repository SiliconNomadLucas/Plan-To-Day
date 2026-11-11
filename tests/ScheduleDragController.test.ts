import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScheduleDragController,
  type ScheduleDragState,
} from "../src/views/ScheduleDragController";

function createState(overrides: Partial<ScheduleDragState> = {}): ScheduleDragState {
  return {
    type: "move",
    taskId: "task-1",
    startY: 100,
    startX: 100,
    origStartMin: 9 * 60,
    origEndMin: 10 * 60,
    dateStr: "2026-11-09",
    hourHeight: 60,
    ghost: {
      style: {} as CSSStyleDeclaration,
      remove: vi.fn(),
    } as unknown as HTMLElement,
    card: { removeClass: vi.fn() } as unknown as HTMLElement,
    moved: false,
    colCount: 1,
    columnsRect: null,
    dateStrs: [],
    currentColIdx: 0,
    ghostBaseLeft: 0,
    scrollContainer: null,
    scrollRAF: null,
    origScrollTop: 0,
    columnsEl: null,
    source: "timeline",
    ...overrides,
  };
}

function createHarness(initialState: ScheduleDragState) {
  let state: ScheduleDragState | null = initialState;
  let lastDragMoved = false;
  const updateTask = vi.fn(async () => undefined);
  const refreshDetail = vi.fn();
  const openTask = vi.fn();
  const setScrollTarget = vi.fn();
  const rerender = vi.fn();
  const controller = new ScheduleDragController({
    getState: () => state,
    setState: (next) => { state = next; },
    setLastDragMoved: (moved) => { lastDragMoved = moved; },
    snapMinute: (pixels, hourHeight) => Math.round((pixels / hourHeight * 60) / 15) * 15,
    minuteToIso: (date, minute) => {
      const capped = Math.min(minute, 1439);
      const hour = String(Math.floor(capped / 60)).padStart(2, "0");
      const minutes = String(capped % 60).padStart(2, "0");
      return `${date}T${hour}:${minutes}:00`;
    },
    updateTask,
    refreshDetail,
    openTask,
    setScrollTarget,
    rerender,
  });
  return {
    controller,
    updateTask,
    refreshDetail,
    openTask,
    setScrollTarget,
    rerender,
    getState: () => state,
    getLastDragMoved: () => lastDragMoved,
  };
}

function mouseEvent(clientX: number, clientY: number): MouseEvent {
  return { clientX, clientY } as MouseEvent;
}

describe("ScheduleDragController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a timed task on a 15-minute grid and focuses it after rerender", async () => {
    const state = createState();
    const harness = createHarness(state);
    harness.controller.handleMove(mouseEvent(100, 115));
    await harness.controller.handleEnd(mouseEvent(100, 115));

    expect(state.moved).toBe(true);
    expect(state.ghost.style.top).toBe("555px");
    expect(harness.updateTask).toHaveBeenCalledWith("task-1", {
      startDate: "2026-11-09T09:15:00",
      dueDate: "2026-11-09T10:15:00",
    });
    expect(harness.refreshDetail).toHaveBeenCalledWith("task-1");
    expect(harness.setScrollTarget).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(harness.rerender).toHaveBeenCalledOnce();
    expect(harness.getState()).toBeNull();
  });

  it("resizes an event without changing its start time", async () => {
    const state = createState({
      type: "resize",
      origStartMin: 9 * 60,
      origEndMin: 10 * 60,
    });
    const harness = createHarness(state);
    harness.controller.handleMove(mouseEvent(100, 160));
    await harness.controller.handleEnd(mouseEvent(100, 160));

    expect(harness.updateTask).toHaveBeenCalledWith("task-1", {
      startDate: "2026-11-09T09:00:00",
      dueDate: "2026-11-09T11:00:00",
    });
  });

  it("moves a week-view task into the horizontally selected day", async () => {
    const state = createState({
      colCount: 7,
      columnsRect: { left: 100, width: 700 } as DOMRect,
      dateStrs: [
        "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
        "2026-11-13", "2026-11-14", "2026-11-15",
      ],
    });
    const harness = createHarness(state);
    harness.controller.handleMove(mouseEvent(450, 100));
    await harness.controller.handleEnd(mouseEvent(450, 100));

    expect(state.ghost.style.left).toBe("300px");
    expect(harness.updateTask).toHaveBeenCalledWith("task-1", {
      startDate: "2026-11-12T09:00:00",
      dueDate: "2026-11-12T10:00:00",
    });
  });

  it("does not update an all-day task dropped outside the week grid", async () => {
    const columnsEl = {
      getBoundingClientRect: () => ({ left: 0, right: 700, top: 100, bottom: 200 }),
    } as unknown as HTMLElement;
    const state = createState({
      source: "allday",
      colCount: 7,
      columnsRect: { left: 0, width: 700 } as DOMRect,
      columnsEl,
      dateStrs: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"],
    });
    const harness = createHarness(state);
    state.moved = true;
    await harness.controller.handleEnd(mouseEvent(450, 250));

    expect(harness.updateTask).not.toHaveBeenCalled();
    expect(harness.setScrollTarget).toHaveBeenCalledWith("preserve");
    expect(harness.rerender).toHaveBeenCalledOnce();
  });

  it("converts an in-grid all-day drop to a timed task on the target day", async () => {
    const columnsEl = {
      getBoundingClientRect: () => ({ left: 0, right: 700, top: 100, bottom: 1540 }),
    } as unknown as HTMLElement;
    const state = createState({
      source: "allday",
      colCount: 7,
      columnsRect: { left: 0, width: 700 } as DOMRect,
      columnsEl,
      dateStrs: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"],
    });
    const harness = createHarness(state);
    state.moved = true;
    await harness.controller.handleEnd(mouseEvent(450, 160));

    expect(harness.updateTask).toHaveBeenCalledWith("task-1", {
      startDate: "2026-11-13T01:00:00",
      dueDate: "2026-11-13T02:00:00",
    });
  });

  it("opens the task when the pointer interaction did not become a drag", async () => {
    const harness = createHarness(createState());
    await harness.controller.handleEnd(mouseEvent(100, 100));

    expect(harness.openTask).toHaveBeenCalledWith("task-1");
    expect(harness.updateTask).not.toHaveBeenCalled();
    expect(harness.getLastDragMoved()).toBe(true);
  });
});
