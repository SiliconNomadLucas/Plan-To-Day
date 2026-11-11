import type { Task } from "../models/Task";
import type { ScheduleScrollTarget } from "./ScheduleRenderer";

export interface ScheduleDragState {
  type: "move" | "resize";
  taskId: string;
  startY: number;
  startX: number;
  origStartMin: number;
  origEndMin: number;
  dateStr: string;
  hourHeight: number;
  ghost: HTMLElement;
  card: HTMLElement;
  moved: boolean;
  colCount: number;
  columnsRect: DOMRect | null;
  dateStrs: string[];
  currentColIdx: number;
  ghostBaseLeft: number;
  scrollContainer: HTMLElement | null;
  scrollRAF: number | null;
  origScrollTop: number;
  columnsEl: HTMLElement | null;
  source: "timeline" | "allday";
}

interface DragCallbacks {
  getState: () => ScheduleDragState | null;
  setState: (state: ScheduleDragState | null) => void;
  setLastDragMoved: (moved: boolean) => void;
  snapMinute: (pixels: number, hourHeight: number) => number;
  minuteToIso: (dateStr: string, minute: number) => string;
  updateTask: (taskId: string, changes: Partial<Task>) => Promise<void>;
  refreshDetail: (taskId: string) => void;
  openTask: (taskId: string) => void;
  setScrollTarget: (target: ScheduleScrollTarget) => void;
  rerender: () => void;
}

export class ScheduleDragController {
  constructor(private readonly callbacks: DragCallbacks) {}

  handleMove(event: MouseEvent): void {
    const state = this.callbacks.getState();
    if (!state) return;
    const rawDeltaY = event.clientY - state.startY;
    const deltaX = event.clientX - state.startX;
    if (!state.moved && Math.abs(rawDeltaY) < 3 && Math.abs(deltaX) < 3) return;
    state.moved = true;
    const scrollChange = state.scrollContainer ? state.scrollContainer.scrollTop - state.origScrollTop : 0;
    const deltaY = rawDeltaY + scrollChange;
    const deltaMin = Math.round((deltaY / state.hourHeight) * 60 / 15) * 15;

    if (state.type === "move") {
      const newStart = Math.max(0, Math.min(1425, state.origStartMin + deltaMin));
      const duration = state.origEndMin - state.origStartMin;
      const newEnd = Math.min(1440, newStart + duration);
      state.ghost.style.top = (newStart / 60 * state.hourHeight) + "px";
      state.ghost.style.height = Math.max(15, (newEnd - newStart) / 60 * state.hourHeight) + "px";
    } else {
      const newEnd = Math.max(state.origStartMin + 15, Math.min(1440, state.origEndMin + deltaMin));
      state.ghost.style.height = Math.max(15, (newEnd - state.origStartMin) / 60 * state.hourHeight) + "px";
    }

    if (state.source === "allday" && state.columnsEl) {
      const columnsRect = state.columnsEl.getBoundingClientRect();
      const snappedMinute = this.callbacks.snapMinute(event.clientY - columnsRect.top, state.hourHeight);
      state.ghost.style.top = Math.max(0, snappedMinute / 60 * state.hourHeight) + "px";
      state.ghost.style.height = state.hourHeight + "px";
    }

    if (state.colCount > 1 && state.columnsRect) {
      const columnWidth = state.columnsRect.width / state.colCount;
      const targetColumn = Math.max(0, Math.min(state.colCount - 1, Math.floor((event.clientX - state.columnsRect.left) / columnWidth)));
      state.ghost.style.left = (state.ghostBaseLeft + (targetColumn - state.currentColIdx) * columnWidth) + "px";
    }

    if (state.scrollContainer) {
      const rect = state.scrollContainer.getBoundingClientRect();
      const threshold = 50;
      const maxSpeed = 15;
      const nearTop = event.clientY - rect.top;
      const nearBottom = rect.bottom - event.clientY;
      let scrollDelta = 0;
      if (nearTop >= 0 && nearTop < threshold) scrollDelta = -Math.round(maxSpeed * (1 - nearTop / threshold));
      else if (nearBottom >= 0 && nearBottom < threshold) scrollDelta = Math.round(maxSpeed * (1 - nearBottom / threshold));
      if (scrollDelta !== 0) {
        if (!state.scrollRAF) {
          const tick = () => {
            const current = this.callbacks.getState();
            if (!current?.scrollContainer) return;
            current.scrollContainer.scrollTop += scrollDelta;
            current.scrollRAF = window.requestAnimationFrame(tick);
          };
          state.scrollRAF = window.requestAnimationFrame(tick);
        }
      } else if (state.scrollRAF) {
        window.cancelAnimationFrame(state.scrollRAF);
        state.scrollRAF = null;
      }
    }
  }

  async handleEnd(event: MouseEvent): Promise<void> {
    const state = this.callbacks.getState();
    if (!state) return;
    this.callbacks.setState(null);
    if (state.scrollRAF) window.cancelAnimationFrame(state.scrollRAF);
    state.card.removeClass("dragging");
    state.ghost.remove();
    this.callbacks.setLastDragMoved(true);
    window.setTimeout(() => this.callbacks.setLastDragMoved(false), 0);

    if (!state.moved) {
      this.callbacks.openTask(state.taskId);
      return;
    }

    let newStart: number;
    let newEnd: number;
    let finalDate = state.dateStr;
    if (state.source === "allday" && state.columnsEl) {
      const columnsRect = state.columnsEl.getBoundingClientRect();
      newStart = Math.max(0, Math.min(1425, this.callbacks.snapMinute(event.clientY - columnsRect.top, state.hourHeight)));
      newEnd = Math.min(1440, newStart + 60);
      if (state.colCount > 1 && state.columnsRect) {
        const columnWidth = state.columnsRect.width / state.colCount;
        const targetColumn = Math.max(0, Math.min(state.colCount - 1, Math.floor((event.clientX - state.columnsRect.left) / columnWidth)));
        if (targetColumn < state.dateStrs.length) finalDate = state.dateStrs[targetColumn];
      }
      if (event.clientY < columnsRect.top || event.clientY > columnsRect.bottom) {
        this.callbacks.setScrollTarget("preserve");
        this.callbacks.rerender();
        return;
      }
    } else {
      const scrollChange = state.scrollContainer ? state.scrollContainer.scrollTop - state.origScrollTop : 0;
      const deltaY = event.clientY - state.startY + scrollChange;
      const deltaMin = Math.round((deltaY / state.hourHeight) * 60 / 15) * 15;
      if (state.type === "move") {
        newStart = Math.max(0, Math.min(1425, state.origStartMin + deltaMin));
        newEnd = Math.min(1440, newStart + state.origEndMin - state.origStartMin);
      } else {
        newStart = state.origStartMin;
        newEnd = Math.max(state.origStartMin + 15, Math.min(1440, state.origEndMin + deltaMin));
      }
      if (state.colCount > 1 && state.columnsRect) {
        const columnWidth = state.columnsRect.width / state.colCount;
        const targetColumn = Math.max(0, Math.min(state.colCount - 1, Math.floor((event.clientX - state.columnsRect.left) / columnWidth)));
        if (targetColumn < state.dateStrs.length) finalDate = state.dateStrs[targetColumn];
      }
    }

    await this.callbacks.updateTask(state.taskId, {
      startDate: this.callbacks.minuteToIso(finalDate, newStart),
      dueDate: this.callbacks.minuteToIso(finalDate, newEnd),
    });
    this.callbacks.refreshDetail(state.taskId);
    this.callbacks.setScrollTarget({ taskId: state.taskId });
    this.callbacks.rerender();
  }
}
