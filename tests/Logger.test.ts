import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, LogLevel } from "../src/utils/logger";

describe("logger", () => {
  afterEach(() => {
    logger.setLevel(LogLevel.ERROR);
    vi.restoreAllMocks();
  });

  it("prints only errors by default", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.info("routine");
    logger.warn("recoverable");
    logger.error("failed");

    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("[PlanToDay]", "failed");
  });

  it("allows explicit informational logging without console.info", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logger.setLevel(LogLevel.INFO);

    logger.info("routine");

    expect(debug).toHaveBeenCalledWith("[PlanToDay]", "routine");
    expect(info).not.toHaveBeenCalled();
  });
});
