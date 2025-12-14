export type SystemFontSuggestion = {
  label: string;
  value: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

export type SystemFontFamily = {
  /** Canonical family name used for saving & CSS font-family. */
  primary: string;
  /** All known localized/display names for the same family (may include primary). */
  names: string[];
};

const getFamilyNames = (family: SystemFontFamily): string[] => {
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return;
    if (!out.some((v) => normalize(v) === normalize(trimmed))) out.push(trimmed);
  };
  push(family.primary);
  for (const name of Array.isArray(family.names) ? family.names : []) push(name);
  return out;
};

export function getSystemFontSuggestions(options: {
  fonts: SystemFontFamily[];
  query: string;
  focused: boolean;
  max?: number;
}): SystemFontSuggestion[] {
  if (!options.focused) return [];
  const fonts = Array.isArray(options.fonts) ? options.fonts : [];
  if (fonts.length === 0) return [];

  const max = Math.max(1, Math.min(50, options.max ?? 20));
  const q = normalize(options.query);
  if (!q) {
    return fonts.slice(0, 12).map((family) => ({ value: family.primary, label: family.primary }));
  }

  const byValue = new Map<string, SystemFontSuggestion>();

  const startsWith: SystemFontSuggestion[] = [];
  const includes: SystemFontSuggestion[] = [];
  for (const family of fonts) {
    const primary = String(family.primary ?? "").trim();
    if (!primary) continue;

    const names = getFamilyNames(family);
    let matchedName: string | null = null;
    let matchedStartsWith = false;
    let matchedIncludes = false;
    for (const name of names) {
      const lower = normalize(name);
      if (!lower) continue;
      if (lower.startsWith(q)) {
        matchedName = name;
        matchedStartsWith = true;
        break;
      }
      if (!matchedIncludes && lower.includes(q)) {
        matchedName = name;
        matchedIncludes = true;
      }
    }

    if (!matchedName || (!matchedStartsWith && !matchedIncludes)) continue;

    const label = normalize(matchedName) === normalize(primary) ? primary : `${matchedName}（${primary}）`;
    const suggestion: SystemFontSuggestion = { value: primary, label };
    const key = normalize(primary);
    if (byValue.has(key)) continue;

    if (matchedStartsWith) startsWith.push(suggestion);
    else includes.push(suggestion);

    if (byValue.size + startsWith.length + includes.length >= max * 2) break;
  }

  for (const suggestion of startsWith.concat(includes)) {
    const key = normalize(suggestion.value);
    if (!byValue.has(key)) byValue.set(key, suggestion);
    if (byValue.size >= max) break;
  }

  return Array.from(byValue.values()).slice(0, max);
}

export function resolveSystemFontFamilyName(options: { fonts: SystemFontFamily[]; input: string }): string {
  const input = options.input.trim();
  if (!input) return "";
  const q = normalize(input);

  const fonts = Array.isArray(options.fonts) ? options.fonts : [];
  for (const family of fonts) {
    const primary = String(family.primary ?? "").trim();
    if (!primary) continue;
    const names = getFamilyNames(family);
    for (const name of names) {
      if (normalize(name) === q) return primary;
    }
  }

  return input;
}
