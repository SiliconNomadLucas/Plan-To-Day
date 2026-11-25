export class TFile {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export class Component {
  private loaded = false;
  private cleanups: Array<() => void> = [];

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.onload();
  }

  unload(): void {
    if (!this.loaded) return;
    this.loaded = false;
    this.onunload();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  onload(): void {}
  onunload(): void {}

  registerEvent(eventRef: { detach(): void }): void {
    this.cleanups.push(() => eventRef.detach());
  }

  registerDomEvent(target: EventTarget, type: string, callback: EventListener): void {
    target.addEventListener(type, callback);
    this.cleanups.push(() => target.removeEventListener(type, callback));
  }
}

export class TestElement {
  children: TestElement[] = [];
  textContent = "";
  value = "";
  title = "";
  dataset: Record<string, string> = {};
  style: { width?: string; height?: string; display?: string } = {};
  scrollTop = 0;
  scrollLeft = 0;
  tabIndex = -1;
  parentElement: TestElement | null = null;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: unknown) => unknown>>();

  constructor(
    public tag = "div",
    public className = "",
  ) {}

  createEl(tag: string, options: {
    text?: string;
    cls?: string;
    value?: string;
    attr?: Record<string, string>;
  } = {}): TestElement {
    const child = new TestElement(tag, options.cls ?? "");
    child.textContent = options.text ?? "";
    child.value = options.value ?? "";
    child.parentElement = this;
    for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
    this.children.push(child);
    return child;
  }

  createDiv(options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): TestElement {
    return this.createEl("div", options);
  }

  createSpan(options: { text?: string; cls?: string; attr?: Record<string, string> } = {}): TestElement {
    return this.createEl("span", options);
  }

  get classList() {
    return {
      contains: (name: string) => this.className.split(/\s+/).includes(name),
      toggle: (name: string, enabled: boolean) => this.toggleClass(name, enabled),
    };
  }

  addClass(...names: string[]): void {
    this.className = `${this.className} ${names.join(" ")}`.trim();
  }

  removeClass(...names: string[]): void {
    for (const name of names) this.toggleClass(name, false);
  }

  hasClass(name: string): boolean {
    return this.className.split(/\s+/).includes(name);
  }

  get ownerDocument(): Document {
    return document;
  }

  contains(element: unknown): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const item = part.trim();
      if (item.startsWith(".")) return item.slice(1).split(".").every((name) => this.hasClass(name));
      const attribute = item.match(/^\[([^=]+)='([^']+)'\]$/);
      return attribute ? this.getAttribute(attribute[1]) === attribute[2] : this.tag === item;
    });
  }

  setText(value: string): void {
    this.textContent = value;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  toggleClass(name: string, enabled: boolean): void {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    if (enabled) classes.add(name);
    else classes.delete(name);
    this.className = [...classes].join(" ");
  }

  closest(selector: string): TestElement | null {
    let element: TestElement | null = this;
    while (element) {
      if (selector.startsWith(".") && element.className.split(/\s+/).includes(selector.slice(1))) return element;
      element = element.parentElement;
    }
    return null;
  }

  empty(): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
  }

  remove(): void {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  after(element: TestElement): void {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    element.parentElement = this.parentElement;
    siblings.splice(index + 1, 0, element);
  }

  prepend(element: TestElement): void {
    element.parentElement = this;
    this.children.unshift(element);
  }

  get isConnected(): boolean {
    return this.parentElement !== null;
  }

  scrollIntoView(_options?: unknown): void {}

  focus(): void {}

  addEventListener(name: string, listener: (event: unknown) => unknown): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  trigger(name: string, event: unknown = {
    target: this,
    stopPropagation: () => undefined,
    preventDefault: () => undefined,
  }): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  async triggerAsync(name: string, event: unknown = {
    target: this,
    stopPropagation: () => undefined,
    preventDefault: () => undefined,
  }): Promise<void> {
    for (const listener of this.listeners.get(name) ?? []) await listener(event);
  }

  click(): void {
    this.trigger("click");
  }

  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): TestElement[] {
    const classes = selector.split(",").map((part) => part.trim()).filter(Boolean);
    const matches: TestElement[] = [];
    const visit = (element: TestElement) => {
      for (const child of element.children) {
        if (classes.some((part) => {
          if (part.startsWith(".")) return child.matches(part);
          const attribute = part.match(/^\[([^=]+)="([^"]+)"\]$/);
          return attribute ? child.getAttribute(attribute[1]) === attribute[2] : child.matches(part);
        })) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  find(predicate: (element: TestElement) => boolean): TestElement | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const match = child.find(predicate);
      if (match) return match;
    }
    return undefined;
  }
}

export class ItemView extends Component {
  app: unknown;
  containerEl = new TestElement();
  contentEl: TestElement;

  constructor(leaf: { app?: unknown }) {
    super();
    this.app = leaf.app;
    this.containerEl.createDiv();
    this.contentEl = this.containerEl.createDiv();
  }
}

export class Plugin extends Component {
  constructor(public app: unknown, public manifest: unknown) { super(); }
}

export class Modal {
  contentEl = new TestElement();

  constructor(_app: unknown) {}

  onOpen(): void {}
  onClose(): void {}

  open(): void {
    this.onOpen();
  }

  close(): void {
    this.onClose();
  }
}

export class SuggestModal<T> extends Modal {
  getSuggestions(_query: string): T[] { return []; }
}

export class MenuItem {
  title = "";
  private action: (() => unknown) | null = null;

  setTitle(title: string): this { this.title = title; return this; }
  setIcon(_icon: string): this { return this; }
  setChecked(_checked: boolean): this { return this; }
  onClick(action: () => unknown): this { this.action = action; return this; }
  trigger(): unknown { return this.action?.(); }
}

export class Menu {
  static instances: Menu[] = [];
  items: MenuItem[] = [];

  constructor() { Menu.instances.push(this); }
  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtPosition(_position: { x: number; y: number }): void {}
}

export class Notice {
  constructor(_message: string) {}
}

export function setIcon(_element: unknown, _icon: string): void {}

export class PluginSettingTab {
  containerEl = new TestElement();

  constructor(_app: unknown, _plugin: unknown) {}

  display(): void {}
  update(): void {}
}

export class Setting {
  settingEl: TestElement;
  controlEl: TestElement;

  constructor(parent: TestElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }

  setName(_name: string): this { return this; }
  setDesc(_description: string): this { return this; }
}
