import { Vault } from "obsidian";
import type { StorageReadResult } from "../models/StorageReadResult";
import { StorageService } from "./StorageService";

export abstract class PersistentJsonService {
  protected readonly storage: StorageService;
  private initialized = false;
  private operationQueue: Promise<void> = Promise.resolve();

  protected constructor(vault: Vault, folder: string) {
    this.storage = new StorageService(vault, folder);
  }

  protected async initializeStore<T>(
    filename: string,
    initialize: (data: T | null) => void | Promise<void>,
  ): Promise<void> {
    await this.storage.init();
    const data = await this.storage.read<T>(filename);
    await initialize(data);
    this.initialized = true;
  }

  protected persistStore<T>(filename: string, data: T): Promise<void> {
    return this.storage.write(filename, data);
  }

  protected readStoreFromDisk(filename: string): Promise<StorageReadResult> {
    return this.storage.readFresh(filename);
  }

  // Public entry points enqueue once; nested work must stay inside the current operation.
  protected runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  protected ensureInitialized(serviceName: string): void {
    if (!this.initialized) {
      throw new Error(`${serviceName} not initialized. Call init() first.`);
    }
  }

  clearCache(): void {
    this.storage.clearCache();
  }
}
