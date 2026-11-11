import type { NavDragPayload } from "../models/NavDragPayload";
import { isRecord } from "./validation";

export function parseNavDragPayload(raw: string): NavDragPayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(value) || (value.type !== "list" && value.type !== "group") ||
      typeof value.id !== "string" || !value.id) {
    return null;
  }
  return { type: value.type, id: value.id };
}
