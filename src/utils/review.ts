import { getISOWeekNumber, getISOWeekRange, getISOWeekYear } from "./period";

export type ReviewMode = "day" | "week" | "month" | "year";

export interface ReviewDateState {
  year: number;
  month: number;
  date: number;
}

export interface ReviewRange {
  start: string;
  end: string;
  weekYear?: number;
  week?: number;
}

export function normalizeReviewDate(state: ReviewDateState): ReviewDateState {
  const date = new Date(state.year, state.month, state.date);
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    date: date.getDate(),
  };
}

export function shiftReviewDate(state: ReviewDateState, mode: ReviewMode, amount: number): ReviewDateState {
  if (mode === "year") return { ...state, year: state.year + amount };
  if (mode === "month") {
    const date = new Date(state.year, state.month + amount, 1);
    return { year: date.getFullYear(), month: date.getMonth(), date: 1 };
  }

  const date = new Date(state.year, state.month, state.date);
  date.setDate(date.getDate() + (mode === "week" ? amount * 7 : amount));
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    date: date.getDate(),
  };
}

export function reviewDateToString(state: ReviewDateState): string {
  return `${state.year}-${String(state.month + 1).padStart(2, "0")}-${String(state.date).padStart(2, "0")}`;
}

export function getReviewRange(state: ReviewDateState, mode: ReviewMode): ReviewRange {
  const selected = new Date(state.year, state.month, state.date);
  if (mode === "day") {
    const date = reviewDateToString(state);
    return { start: date, end: date };
  }
  if (mode === "month") {
    return {
      start: formatDate(new Date(state.year, state.month, 1)),
      end: formatDate(new Date(state.year, state.month + 1, 0)),
    };
  }
  if (mode === "year") {
    return { start: `${state.year}-01-01`, end: `${state.year}-12-31` };
  }

  const weekYear = getISOWeekYear(selected);
  const week = getISOWeekNumber(selected);
  const range = getISOWeekRange(weekYear, week);
  return {
    start: formatDate(range.start),
    end: formatDate(range.end),
    weekYear,
    week,
  };
}

export function formatReviewTitle(state: ReviewDateState, mode: ReviewMode, english: boolean): string {
  const selected = new Date(state.year, state.month, state.date);
  if (mode === "day") {
    if (english) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        weekday: "long",
      }).format(selected);
    }
    const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${state.month + 1}月${state.date}日 ${dayNames[selected.getDay()]}`;
  }
  if (mode === "week") {
    const range = getReviewRange(state, mode);
    const weekYear = range.weekYear!;
    const week = range.week!;
    const start = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    const englishSpan = `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
    const chineseSpan = `${start.getMonth() + 1}.${start.getDate()} - ${end.getMonth() + 1}.${end.getDate()}`;
    return english ? `${weekYear} Week ${week} (${englishSpan})` : `${weekYear}年第${week}周 (${chineseSpan})`;
  }
  if (mode === "month") {
    return english
      ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(state.year, state.month, 1))
      : `${state.year}年 ${state.month + 1}月`;
  }
  return english ? String(state.year) : `${state.year}年`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
