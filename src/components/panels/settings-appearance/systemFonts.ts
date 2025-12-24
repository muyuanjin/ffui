import type { SystemFontFamily } from "@/lib/systemFontSearch";

export const normalizeSystemFontFamilies = (raw: unknown): SystemFontFamily[] => {
  const byPrimary = new Map<string, SystemFontFamily>();
  const normalizeKey = (value: string) => value.trim().toLowerCase();

  for (const entry of Array.isArray(raw) ? raw : []) {
    const primary = String((entry as { primary?: unknown }).primary ?? "").trim();
    if (!primary) continue;

    const names: string[] = Array.isArray((entry as { names?: unknown }).names)
      ? (entry as { names: unknown[] }).names.map((name) => String(name ?? "").trim()).filter((name) => name.length > 0)
      : [];
    const key = normalizeKey(primary);

    const existing = byPrimary.get(key);
    if (!existing) {
      byPrimary.set(key, { primary, names });
      continue;
    }

    existing.names = Array.from(
      new Map(
        existing.names
          .concat(names)
          .map((name) => String(name ?? "").trim())
          .filter((name) => name.length > 0)
          .map((name) => [normalizeKey(name), name] as const),
      ).values(),
    );
  }

  return Array.from(byPrimary.values()).sort((a, b) => a.primary.localeCompare(b.primary));
};
