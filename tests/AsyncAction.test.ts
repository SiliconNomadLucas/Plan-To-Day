import { describe, expect, it, vi } from "vitest";
import { runAsyncAction } from "../src/utils/async-action";
import { logger } from "../src/utils/logger";

describe("async UI actions", () => {
  it("reports rejected actions instead of leaving an unhandled promise", async () => {
    const error = new Error("disk full");
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    runAsyncAction(Promise.reject(error), "save task");

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Failed to save task:", error));
  });
});
