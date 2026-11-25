import { Vault } from "obsidian";
import { ListGroup, createGroup } from "../models/Group";
import { PersistentJsonService } from "./PersistentJsonService";
import { logger } from "../utils/logger";
import type { ServiceReloadResult } from "../models/ServiceReloadResult";
import { isRecord, stableSerialize } from "../utils/validation";

export interface GroupStore {
  groups: ListGroup[];
}

const STORE_FILENAME = "groups.json";

export class GroupService extends PersistentJsonService {
  private groups: ListGroup[] = [];
  private persistedGroups = "[]";
  private saveFailed = false;

  constructor(vault: Vault, folder: string) {
    super(vault, folder);
  }

  async init(): Promise<void> {
    await this.initializeStore<GroupStore>(STORE_FILENAME, (store) => {
      if (store && store.groups) {
        this.groups = store.groups;
        logger.info("Loaded", this.groups.length, "groups");
      } else {
        this.groups = [];
        logger.info("No existing groups, starting fresh");
      }
      this.persistedGroups = stableSerialize(this.groups);
      this.saveFailed = false;
    });
  }

  hasUnsavedChanges(): boolean {
    this.ensureLoaded();
    return this.saveFailed || stableSerialize(this.groups) !== this.persistedGroups;
  }

  async reloadFromDisk(): Promise<ServiceReloadResult> {
    this.ensureLoaded();
    if (this.hasUnsavedChanges()) return { status: "deferred", reason: "unsaved-changes" };
    const snapshot = await this.readStoreFromDisk(STORE_FILENAME);
    if (this.hasUnsavedChanges()) return { status: "deferred", reason: "unsaved-changes" };
    if (snapshot.status === "missing") {
      return this.groups.length === 0 ? { status: "unchanged" } : { status: "missing" };
    }
    if (!isRecord(snapshot.data) || !Array.isArray(snapshot.data.groups) || !snapshot.data.groups.every(isListGroup)) {
      throw new Error("Invalid groups store: expected a valid groups array.");
    }
    const groups = snapshot.data.groups.map((group) => ({ ...group }));
    if (stableSerialize(groups) === this.persistedGroups) return { status: "unchanged" };
    this.groups = groups;
    this.persistedGroups = stableSerialize(groups);
    this.storage.clearCache();
    return { status: "reloaded" };
  }

  getAll(): ListGroup[] {
    this.ensureLoaded();
    return [...this.groups].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getById(id: string): ListGroup | undefined {
    this.ensureLoaded();
    return this.groups.find((g) => g.id === id);
  }

  async create(fields: Partial<ListGroup>): Promise<ListGroup> {
    this.ensureLoaded();
    const group = createGroup(fields);
    this.groups.push(group);
    await this.save();
    logger.info("Group created:", group.name);
    return group;
  }

  async update(id: string, changes: Partial<ListGroup>): Promise<ListGroup | null> {
    this.ensureLoaded();
    const index = this.groups.findIndex((g) => g.id === id);
    if (index === -1) {
      logger.warn("Group not found:", id);
      return null;
    }
    this.groups[index] = {
      ...this.groups[index],
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    logger.info("Group updated:", id);
    return this.groups[index];
  }

  async rename(id: string, newName: string): Promise<ListGroup | null> {
    return this.update(id, { name: newName });
  }

  async toggleCollapse(id: string): Promise<ListGroup | null> {
    const group = this.groups.find((g) => g.id === id);
    if (!group) return null;
    return this.update(id, { isCollapsed: !group.isCollapsed });
  }

  async delete(id: string): Promise<boolean> {
    this.ensureLoaded();
    const group = this.groups.find((g) => g.id === id);
    if (!group) {
      logger.warn("Group not found for delete:", id);
      return false;
    }
    this.groups = this.groups.filter((g) => g.id !== id);
    await this.save();
    logger.info("Group deleted:", group.name);
    return true;
  }

  private async save(): Promise<void> {
    const groups = this.groups.map((group) => ({ ...group }));
    try {
      await this.persistStore(STORE_FILENAME, { groups });
      this.persistedGroups = stableSerialize(groups);
      this.saveFailed = false;
    } catch (error) {
      this.saveFailed = true;
      throw error;
    }
  }

  private ensureLoaded(): void {
    this.ensureInitialized("GroupService");
  }
}

function isListGroup(value: unknown): value is ListGroup {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.sortOrder === "number"
    && typeof value.isCollapsed === "boolean"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}
