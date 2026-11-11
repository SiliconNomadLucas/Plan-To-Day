import { Vault } from "obsidian";
import { PersistentJsonService } from "./PersistentJsonService";
import { RecurrenceSeries } from "../models/RecurrenceSeries";

interface RecurrenceSeriesDatabase {
  series: RecurrenceSeries[];
}

const FILENAME = "recurrence-series.json";

export class RecurrenceSeriesService extends PersistentJsonService {
  private series: RecurrenceSeries[] = [];

  constructor(vault: Vault, folder: string) {
    super(vault, folder);
  }

  async init(): Promise<void> {
    await this.initializeStore<RecurrenceSeriesDatabase>(FILENAME, (db) => {
      this.series = db?.series ?? [];
    });
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
    await this.persistStore<RecurrenceSeriesDatabase>(FILENAME, { series: this.series });
  }

  private ensureLoaded(): void {
    this.ensureInitialized("RecurrenceSeriesService");
  }
}
