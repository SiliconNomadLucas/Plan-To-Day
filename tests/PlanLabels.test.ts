import { describe, expect, it } from "vitest";
import { localizedPeriodLabel, localizedSubGroupLabel } from "../src/utils/plan-labels";

describe("plan labels", () => {
  it("formats Chinese labels through the existing period helpers", () => {
    expect(localizedPeriodLabel("quarter", "2026-Q2", false)).toBe("2026 Q2 计划");
    expect(localizedSubGroupLabel("week", "2026-W09", false)).toBe("W09 周计划");
  });

  it("formats English labels without putting locale logic in the view", () => {
    expect(localizedPeriodLabel("month", "2026-11", true)).toBe("November 2026 Month Plan");
    expect(localizedSubGroupLabel("quarter", "2026-Q2", true)).toBe("Q2 Quarter Plan");
  });
});
