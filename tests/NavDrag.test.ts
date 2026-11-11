import { describe, expect, it } from "vitest";
import { parseNavDragPayload } from "../src/utils/nav-drag";

describe("navigation drag payloads", () => {
  it("accepts only list and group ids", () => {
    expect(parseNavDragPayload('{"type":"list","id":"list-1"}')).toEqual({ type: "list", id: "list-1" });
    expect(parseNavDragPayload('{"type":"group","id":"group-1"}')).toEqual({ type: "group", id: "group-1" });
  });

  it.each([
    "", "{invalid", "null", "[]",
    '{"type":"task","id":"x"}',
    '{"type":"list","id":1}',
    '{"type":"list","id":""}',
  ])("ignores malformed or unrelated data: %s", (raw) => {
    expect(parseNavDragPayload(raw)).toBeNull();
  });
});
