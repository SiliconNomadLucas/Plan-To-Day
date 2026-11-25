import { Vault } from "obsidian";
import { PersistentJsonService } from "./PersistentJsonService";
import { RecurrenceSeries } from "../models/RecurrenceSeries";
import type { ServiceReloadResult } from "../models/ServiceReloadResult";
import { isRecord, stableSerialize } from "../utils/validation";

interface RecurrenceSeriesDatabase {
  series: RecurrenceSeries[];
}

const FILENAME = "recurrence-series.json";

export class RecurrenceSeriesService extends PersistentJsonService {
  private series: RecurrenceSeries[] = [];
  private persistedSeries = "[]";
  private saveFailed = false;

  constructor(vault: Vault, folder: string) {
    super(vault, folder);
  }

  async init(): Promise<void> {
    await this.initializeStore<RecurrenceSeriesDatabase>(FILENAME, (db) => {
      this.series = db?.series ?? [];
      this.persistedSeries = stableSerialize(this.series);
      this.saveFailed = false;
    });
  }

  hasUnsavedChanges(): boolean {
    this.ensureLoaded();
    return this.saveFailed || stableSerialize(this.series) !== this.persistedSeries;
  }

  async reloadFromDisk(): Promise<ServiceReloadResult> {
    this.ensureLoaded();
    if (this.hasUnsavedChanges()) return { status: "deferred", reason: "unsaved-changes" };
    const snapshot = await this.readStoreFromDisk(FILENAME);
    if (this.hasUnsavedChanges()) return { status: "deferred", reason: "unsaved-changes" };
    if (snapshot.status === "missing") {
      return this.series.length === 0 ? { status: "unchanged" } : { status: "missing" };
    }
    if (!isRecord(snapshot.data) || !Array.isArray(snapshot.data.series) || !snapshot.data.series.every(isRecurrenceSeries)) {
      throw new Error("Invalid recurrence series store: expected a valid series array.");
    }
    const series = snapshot.data.series.map((item) => ({ ...item, tags: [...item.tags] }));
    if (stableSerialize(series) === this.persistedSeries) return { status: "unchanged" };
    this.series = series;
    this.persistedSeries = stableSerialize(series);
    this.storage.clearCache();
    return { status: "reloaded" };
  }

  getAll(): RecurrenceSeries[] {
    this.ensureLoaded();
    return [...this.series];
  }

  get(id: string): RecurrenceSeries | undefined {
    this.ensureLoaded();
    return this.series.find((item) => item.id === id);
  }

  async upsert(item: RecurrenceSeries): Promise<RecurrenceSeries> {
    this.ensureLoaded();
    const index = this.series.findIndex((entry) => entry.id === item.id);
    item.updatedAt = new Date().toISOString();
    if (index >= 0) this.series[index] = item;
    else this.series.push(item);
    await this.save();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();
    const before = this.series.length;
    this.series = this.series.filter((item) => item.id !== id);
    if (before === this.series.length) return false;
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    const series = this.series.map((item) => ({ ...item, tags: [...item.tags] }));
    try {
      await this.persistStore<RecurrenceSeriesDatabase>(FILENAME, { series });
      this.persistedSeries = stableSerialize(series);
      this.saveFailed = false;
    } catch (error) {
      this.saveFailed = true;
      throw error;
    }
  }

  private ensureLoaded(): void {
    this.ensureInitialized("RecurrenceSeriesService");
  }
}

function isRecurrenceSeries(value: unknown): value is RecurrenceSeries {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.rule === "string"
    && typeof value.startDate === "string"
    && (typeof value.endDate === "string" || value.endDate === null)
    && typeof value.title === "string"
    && typeof value.note === "string"
    && typeof value.listId === "string"
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === "string")
    && typeof value.isImportant === "boolean"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}
