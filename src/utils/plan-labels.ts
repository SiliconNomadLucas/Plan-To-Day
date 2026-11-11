import type { PlanKind } from "../models/Task";
import { periodLabel, subGroupLabel } from "./period";

export function localizedPeriodLabel(kind: PlanKind, key: string, english: boolean): string {
  if (!english) return periodLabel(kind, key);

  switch (kind) {
    case "year":
      return `${key} Year Plan`;
    case "quarter": {
      const [year, quarter] = key.split("-Q");
      return `${year} Q${quarter} Quarter Plan`;
    }
    case "month": {
      const [year, month] = key.split("-");
      const date = new Date(Number(year), Number(month) - 1, 1);
      const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
      return `${monthName} ${year} Month Plan`;
    }
    case "week": {
      const [year, week] = key.split("-W");
      return `${year} W${week} Week Plan`;
    }
    default:
      return periodLabel(kind, key);
  }
}

export function localizedSubGroupLabel(kind: PlanKind, key: string, english: boolean): string {
  if (!english) return subGroupLabel(kind, key);

  switch (kind) {
    case "quarter":
      return `Q${key.split("-Q")[1]} Quarter Plan`;
    case "week":
      return `W${key.split("-W")[1]} Week Plan`;
    default:
      return localizedPeriodLabel(kind, key, english);
  }
}
