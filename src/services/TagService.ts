import { Vault } from "obsidian";
import { DomainTag, createTag, DEFAULT_DOMAIN_TAGS } from "../models/Tag";
import { PersistentJsonService } from "./PersistentJsonService";
import { logger } from "../utils/logger";

export interface TagStore {
  tags: DomainTag[];
}

const STORE_FILENAME = "tags.json";

export class TagService extends PersistentJsonService {
  private tags: DomainTag[] = [];

  constructor(vault: Vault, folder: string) {
    super(vault, folder);
  }

  async init(): Promise<void> {
    await this.initializeStore<TagStore>(STORE_FILENAME, async (store) => {
      if (store && store.tags) {
        this.tags = store.tags;
        logger.info("Loaded", this.tags.length, "tags");
      } else {
        this.tags = [];
        logger.info("No existing tags, starting fresh");
      }
      await this.ensureDefaultTags();
    });
  }

  getAll(): DomainTag[] {
    this.ensureLoaded();
    return [...this.tags].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getById(id: string): DomainTag | undefined {
    this.ensureLoaded();
    return this.tags.find((t) => t.id === id);
  }

  async create(fields: Partial<DomainTag>): Promise<DomainTag> {
    this.ensureLoaded();
    const tag = createTag(fields);
    this.tags.push(tag);
    await this.save();
    logger.info("Tag created:", tag.name);
    return tag;
  }

  async update(id: string, changes: Partial<DomainTag>): Promise<DomainTag | null> {
    this.ensureLoaded();
    const index = this.tags.findIndex((t) => t.id === id);
    if (index === -1) {
      logger.warn("Tag not found:", id);
      return null;
    }
    this.tags[index] = {
      ...this.tags[index],
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
    logger.info("Tag updated:", id);
    return this.tags[index];
  }

  async delete(id: string): Promise<boolean> {
    this.ensureLoaded();
    const tag = this.tags.find((t) => t.id === id);
    if (!tag) {
      logger.warn("Tag not found for delete:", id);
      return false;
    }
    if (tag.isDefault) {
      logger.warn("Cannot delete default tag:", tag.name);
      return false;
    }
    this.tags = this.tags.filter((t) => t.id !== id);
    await this.save();
    logger.info("Tag deleted:", tag.name);
    return true;
  }

  getQuadrantTags(): DomainTag[] {
    this.ensureLoaded();
    return this.tags.filter((t) => t.isDefault && t.sortOrder < 4).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getQuadrantTagForTask(tagIds: string[]): DomainTag | undefined {
    this.ensureLoaded();
    return this.tags.find((t) => t.isDefault && t.sortOrder < 4 && tagIds.includes(t.id));
  }

  private async save(): Promise<void> {
    const store: TagStore = { tags: this.tags };
    await this.persistStore(STORE_FILENAME, store);
  }

  private async ensureDefaultTags(): Promise<void> {
    const hasDefaults = this.tags.some((t) => t.isDefault);
    if (!hasDefaults) {
      for (const def of DEFAULT_DOMAIN_TAGS) {
        const tag = createTag(def);
        this.tags.push(tag);
      }
      await this.save();
      logger.info("Default domain tags created:", DEFAULT_DOMAIN_TAGS.length);
    }
  }

  private ensureLoaded(): void {
    this.ensureInitialized("TagService");
  }
}
