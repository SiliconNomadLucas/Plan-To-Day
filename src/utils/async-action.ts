import { Notice } from "obsidian";
import { t } from "../i18n";
import { logger } from "./logger";

export function reportAsyncError(context: string, error: unknown): void {
  logger.error(`Failed to ${context}:`, error);
  new Notice(t("操作失败，请重试"));
}

export function runAsyncAction(promise: Promise<unknown>, context: string): void {
  void promise.catch((error: unknown) => reportAsyncError(context, error));
}
