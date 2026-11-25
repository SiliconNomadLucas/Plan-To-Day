import { Component, normalizePath, type TAbstractFile, type Vault } from "obsidian";
import type { DataSyncReloadResult } from "../models/DataSyncReloadResult";
import { SYNC_DATA_FILES, type SyncDataFile } from "../models/SyncDataFile";
import { logger } from "../utils/logger";

const DEBOUNCE_MS = 500;
const RETRY_DELAYS_MS = [500, 1000, 2000];

export class DataSyncCoordinator extends Component {
  private readonly dataFolder: string;
  private active = false;
  private generation = 0;
  private pauseDepth = 0;
  private pending = false;
  private retryAttempt = 0;
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  private refreshPending = false;
  private pendingFiles = new Set<SyncDataFile>();

  constructor(
    private readonly vault: Vault,
    folder: string,
    private readonly reload: (files: readonly SyncDataFile[]) => Promise<DataSyncReloadResult>,
    private readonly onReloaded: () => void | boolean | Promise<void | boolean> = () => undefined,
    private readonly canReload: () => boolean = () => true,
  ) {
    super();
    this.dataFolder = normalizePath(folder);
  }

  onload(): void {
    this.active = true;
    this.generation++;
    const onChange = (file: TAbstractFile) => this.handleChange(file.path);
    this.registerEvent(this.vault.on("modify", onChange));
    this.registerEvent(this.vault.on("create", onChange));
    this.registerEvent(this.vault.on("delete", onChange));
    this.registerEvent(this.vault.on("rename", (file, oldPath) => this.handleChange(file.path, oldPath)));
    this.registerDomEvent(window, "focus", () => this.requestReload());
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") this.requestReload();
    });
    // Catch changes that arrived between service initialization and layout readiness.
    this.requestReload();
  }

  onunload(): void {
    this.active = false;
    this.generation++;
    this.pending = false;
    this.refreshPending = false;
    this.pendingFiles.clear();
    this.clearTimer();
  }

  requestReload(files: readonly SyncDataFile[] = SYNC_DATA_FILES): void {
    if (!this.canRun()) return;
    for (const file of files) this.pendingFiles.add(file);
    this.pending = true;
    this.retryAttempt = 0;
    this.schedule(DEBOUNCE_MS);
  }

  async pause(): Promise<void> {
    this.pauseDepth++;
    this.pending = false;
    this.refreshPending = false;
    this.pendingFiles.clear();
    this.clearTimer();
    // Reset must wait until a reload already queued in TaskService has settled.
    await this.inFlight;
  }

  resume(): void {
    if (this.pauseDepth === 0) return;
    this.pauseDepth--;
    if (this.pauseDepth === 0) this.requestReload();
  }

  private handleChange(path: string, oldPath?: string): void {
    const files = new Set<SyncDataFile>(this.filesForPath(path));
    if (oldPath !== undefined) {
      for (const file of this.filesForPath(oldPath)) files.add(file);
    }
    if (files.size > 0) this.requestReload([...files]);
  }

  private filesForPath(path: string): SyncDataFile[] {
    const normalized = normalizePath(path);
    const exact = SYNC_DATA_FILES.filter((filename) => normalized === this.pathFor(filename));
    if (exact.length > 0) return exact;
    // Parent folder events can cover multiple data files.
    if (normalized === this.dataFolder || this.dataFolder.startsWith(`${normalized}/`)) {
      return [...SYNC_DATA_FILES];
    }
    return [];
  }

  private pathFor(filename: SyncDataFile): string {
    return this.dataFolder ? `${this.dataFolder}/${filename}` : filename;
  }

  private canRun(): boolean {
    return this.active && this.pauseDepth === 0;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.canRun() || !this.pending || this.inFlight) return;

      const run = this.reloadPending();
      this.inFlight = run;
      void run.then(() => {
        this.inFlight = null;
        if (this.canRun() && this.pending && this.timer === null) this.schedule(DEBOUNCE_MS);
      });
    }, delay);
  }

  private async reloadPending(): Promise<void> {
    const generation = this.generation;
    const files = [...this.pendingFiles];
    this.pendingFiles.clear();
    if (files.length === 0) return;
    this.pending = false;
    try {
      if (!this.canReload()) {
        for (const file of files) this.pendingFiles.add(file);
        this.pending = true;
        this.schedule(250);
        return;
      }
      const result = await this.reload(files);
      if (!this.canRun() || generation !== this.generation) return;
      logger.debug("Data sync reload:", files, result.status);
      if (result.status === "reloaded") {
        this.refreshPending = true;
        logger.info("Synced data reloaded:", files);
      }
      if (this.refreshPending && (result.status === "reloaded" || result.status === "unchanged")) {
        const refreshed = await this.onReloaded();
        if (!this.canRun() || generation !== this.generation) return;
        if (refreshed === false) {
          for (const file of files) this.pendingFiles.add(file);
          this.pending = true;
          this.schedule(250);
          return;
        }
        this.refreshPending = false;
      }
      const retryFiles = result.retryFiles
        ?? (result.status === "missing" || result.status === "deferred" ? files : []);
      if (retryFiles.length > 0) {
        for (const file of retryFiles) this.pendingFiles.add(file);
        this.retry("data files not ready");
        return;
      }
    } catch (error) {
      if (!this.canRun() || generation !== this.generation) return;
      logger.warn("Data sync reload failed:", files, error);
      for (const file of files) this.pendingFiles.add(file);
      this.retry("failed");
    }
  }

  private retry(reason: string): void {
    // A newer file event owns a fresh debounce and retry budget.
    if (this.pending) return;
    if (this.retryAttempt >= RETRY_DELAYS_MS.length) {
      logger.warn("Data sync retries exhausted; keeping current data:", [...this.pendingFiles], reason);
      this.pendingFiles.clear();
      return;
    }
    this.pending = true;
    this.schedule(RETRY_DELAYS_MS[this.retryAttempt++]);
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
