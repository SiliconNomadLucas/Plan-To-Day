export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) => {
    if (!isRecord(item)) return item;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) sorted[key] = item[key];
    return sorted;
  });
}
