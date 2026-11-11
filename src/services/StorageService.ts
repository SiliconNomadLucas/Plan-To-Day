import { Vault, TFile } from "obsidian";
import { logger } from "../utils/logger";

export interface StorageMeta {
  
  dataVersion: number;
  
  lastModified: string;
}

export interface StorageFile<T> {
  meta: StorageMeta;
  data: T;
}

export type BackupResult = "created" | "already-exists" | "missing-source" | "failed";

const CURRENT_DATA_VERSION = 1;
const DEFAULT_BACKUP_RETENTION_DAYS = 30;

export class StorageService {
  private vault: Vault;
  private folder: string;
  private backupRetentionDays: number;

  
  
  private cache: Map<string, unknown> = new Map();

  
  
  private writeQueues: Map<string, Promise<void>> = new Map();
  private backupQueues: Map<string, Promise<BackupResult>> = new Map();

  
  constructor(vault: Vault, folder: string, backupRetentionDays = DEFAULT_BACKUP_RETENTION_DAYS) {
    this.vault = vault;
    this.folder = folder;
    this.backupRetentionDays = Math.max(1, Math.floor(backupRetentionDays));
  }

  
  async init(): Promise<void> {
    
    await this.ensureFolder(this.folder);
    await this.ensureFolder(this.folder + "/backups");
    logger.info("StorageService initialized, folder:", this.folder);
  }

  
  async read<T>(filename: string): Promise<T | null> {
    const path = this.getPath(filename);

    
    if (this.cache.has(path)) {
      logger.debug("Cache hit:", path);
      return this.cache.get(path) as T;
    }

    try {
      
      if (!(await this.vault.adapter.exists(path))) {
        logger.debug("File not found:", path);
        return null;
      }
      const file = this.vault.getAbstractFileByPath(path);
      let raw: string;
      if (file instanceof TFile) {
        raw = await this.vault.read(file);
      } else {
        
        raw = await this.vault.adapter.read(path);
      }
      const parsed = JSON.parse(raw) as StorageFile<T>;
      
      this.cache.set(path, parsed.data);
      logger.debug("Read from disk:", path);
      return parsed.data;
    } catch (e) {
      logger.error("Failed to read:", path, e);
      throw e;
    }
  }

  
  async write<T>(filename: string, data: T): Promise<void> {
    const path = this.getPath(filename);

    
    const prev = this.writeQueues.get(path) || Promise.resolve();
    // A failed write must not poison the queue for every later write to this file.
    const next = prev.catch(() => undefined).then(async () => {
      try {
        
        const file: StorageFile<T> = {
          meta: {
            dataVersion: CURRENT_DATA_VERSION,
            lastModified: new Date().toISOString(),
          },
          data,
        };
        const content = JSON.stringify(file, null, 2);

        if (await this.vault.adapter.exists(path)) {
          
          const existing = this.vault.getAbstractFileByPath(path);
          if (existing instanceof TFile) {
            await this.vault.modify(existing, content);
          } else {
            
            await this.vault.adapter.write(path, content);
          }
        } else {
          
          await this.vault.create(path, content);
        }

        
        this.cache.set(path, data);
        logger.debug("Written:", path);
      } catch (e) {
        logger.error("Failed to write:", path, e);
        throw e;
      }
    });

    
    this.writeQueues.set(path, next);
    try {
      await next;
    } finally {
      if (this.writeQueues.get(path) === next) {
        this.writeQueues.delete(path);
      }
    }
  }

  
  async backup(filename: string): Promise<BackupResult> {
    const path = this.getPath(filename);
    const previous = this.backupQueues.get(path) || Promise.resolve("already-exists" as BackupResult);
    const next = previous.then(
      () => this.createDailyBackup(filename),
      () => this.createDailyBackup(filename),
    );
    this.backupQueues.set(path, next);
    try {
      return await next;
    } finally {
      if (this.backupQueues.get(path) === next) {
        this.backupQueues.delete(path);
      }
    }
  }

  
  clearCache(): void {
    this.cache.clear();
  }

  
  private getPath(filename: string): string {
    return `${this.folder}/${filename}`;
  }

  
  private async ensureFolder(path: string): Promise<void> {
    if (!(await this.vault.adapter.exists(path))) {
      await this.vault.createFolder(path);
    }
  }

  private async createDailyBackup(filename: string): Promise<BackupResult> {
    const sourcePath = this.getPath(filename);
    const backupFolder = `${this.folder}/backups`;
    try {
      if (!(await this.vault.adapter.exists(sourcePath))) return "missing-source";

      const date = this.localDateString(new Date());
      const backupPath = `${backupFolder}/${date}_${filename}`;
      let result: BackupResult = "already-exists";
      if (!(await this.vault.adapter.exists(backupPath))) {
        const raw = await this.vault.adapter.read(sourcePath);
        await this.vault.create(backupPath, raw);
        logger.info("Backup created:", backupPath);
        result = "created";
      }
      try {
        await this.pruneBackups(filename);
      } catch (error) {
        logger.warn("Backup retention cleanup failed:", filename, error);
      }
      return result;
    } catch (error) {
      logger.error("Backup failed:", filename, error);
      return "failed";
    }
  }

  private async pruneBackups(filename: string): Promise<void> {
    const backupFolder = `${this.folder}/backups`;
    const listed = await this.vault.adapter.list(backupFolder);
    const suffix = `_${filename}`;
    const snapshots = listed.files
      .map((entry) => {
        const name = entry.substring(entry.lastIndexOf("/") + 1);
        const match = name.match(/^(\d{4}-\d{2}-\d{2})_/);
        if (!match || !name.endsWith(suffix)) return null;
        const path = entry.includes("/") ? entry : `${backupFolder}/${entry}`;
        return { path, date: match[1] };
      })
      .filter((snapshot): snapshot is { path: string; date: string } => snapshot !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    for (const snapshot of snapshots.slice(this.backupRetentionDays)) {
      await this.vault.adapter.remove(snapshot.path);
      logger.info("Expired backup removed:", snapshot.path);
    }
  }

  private localDateString(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
}
