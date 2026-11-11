import { Vault } from "obsidian";
import { StorageService } from "./StorageService";

export abstract class PersistentJsonService {
  protected readonly storage: StorageService;
  private initialized = false;

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

  protected ensureInitialized(serviceName: string): void {
    if (!this.initialized) {
      throw new Error(`${serviceName} not initialized. Call init() first.`);
    }
  }

  clearCache(): void {
    this.storage.clearCache();
  }
}
