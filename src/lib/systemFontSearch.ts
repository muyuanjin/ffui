export type SystemFontSuggestion = {
  label: string;
  value: string;
};

type AliasSpec = {
  aliases: string[];
  candidates: string[];
};

const ALIAS_SPECS: AliasSpec[] = [
  // Windows (CJK)
  { aliases: ["微软雅黑"], candidates: ["Microsoft YaHei UI", "Microsoft YaHei"] },
  { aliases: ["等线"], candidates: ["DengXian"] },
  { aliases: ["黑体"], candidates: ["SimHei"] },
  { aliases: ["宋体"], candidates: ["SimSun"] },
  { aliases: ["新宋体"], candidates: ["NSimSun"] },
  { aliases: ["楷体"], candidates: ["KaiTi"] },
  { aliases: ["仿宋"], candidates: ["FangSong"] },

  // macOS / cross-platform CJK (common)
  { aliases: ["苹方"], candidates: ["PingFang SC", "PingFang TC", "PingFang HK"] },
  { aliases: ["思源黑体"], candidates: ["Source Han Sans SC", "Source Han Sans"] },
  { aliases: ["思源宋体"], candidates: ["Source Han Serif SC", "Source Han Serif"] },
  { aliases: ["noto sans cjk"], candidates: ["Noto Sans CJK SC", "Noto Sans CJK"] },
];

const normalize = (value: string) => value.trim().toLowerCase();

const findExistingCandidates = (fonts: string[], candidates: string[]): string[] => {
  if (!Array.isArray(fonts) || fonts.length === 0) return [];
  const byLower = new Map(fonts.map((name) => [normalize(name), name] as const));
  const out: string[] = [];
  for (const candidate of candidates) {
    const hit = byLower.get(normalize(candidate));
    if (hit) out.push(hit);
  }
  return out;
};

const getAliasesForFontName = (fontName: string): string[] => {
  const lower = normalize(fontName);
  for (const spec of ALIAS_SPECS) {
    for (const candidate of spec.candidates) {
      if (lower === normalize(candidate)) return spec.aliases.slice();
    }
  }
  return [];
};

const findAliasMatches = (fonts: string[], query: string): SystemFontSuggestion[] => {
  const q = normalize(query);
  if (!q) return [];
  const out: SystemFontSuggestion[] = [];
  for (const spec of ALIAS_SPECS) {
    const aliasHit = spec.aliases.find((a) => normalize(a).includes(q));
    if (!aliasHit) continue;
    const existing = findExistingCandidates(fonts, spec.candidates);
    for (const name of existing) {
      out.push({ value: name, label: `${name}（${aliasHit}）` });
    }
  }
  return out;
};

export function getSystemFontSuggestions(options: {
  fonts: string[];
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
    return fonts.slice(0, 12).map((value) => ({ value, label: value }));
  }

  const byValue = new Map<string, SystemFontSuggestion>();

  for (const suggestion of findAliasMatches(fonts, q)) {
    const key = normalize(suggestion.value);
    if (!byValue.has(key)) byValue.set(key, suggestion);
  }

  const startsWith: SystemFontSuggestion[] = [];
  const includes: SystemFontSuggestion[] = [];
  for (const name of fonts) {
    const lower = normalize(name);
    const aliases = getAliasesForFontName(name);
    const aliasHit = aliases.find((a) => normalize(a).includes(q));

    const matchesStartsWith = lower.startsWith(q) || aliases.some((a) => normalize(a).startsWith(q));
    const matchesIncludes = lower.includes(q) || aliases.some((a) => normalize(a).includes(q));

    if (!matchesStartsWith && !matchesIncludes) continue;

    const label = aliasHit && !lower.includes(q) ? `${name}（${aliasHit}）` : name;
    const suggestion: SystemFontSuggestion = { value: name, label };
    const key = normalize(name);
    if (byValue.has(key)) continue;

    if (matchesStartsWith) startsWith.push(suggestion);
    else includes.push(suggestion);

    if (byValue.size + startsWith.length + includes.length >= max * 2) {
      // Guard against pathological cases; we still dedupe and trim below.
      break;
    }
  }

  for (const suggestion of startsWith.concat(includes)) {
    const key = normalize(suggestion.value);
    if (!byValue.has(key)) byValue.set(key, suggestion);
    if (byValue.size >= max) break;
  }

  return Array.from(byValue.values()).slice(0, max);
}

export function resolveSystemFontFamilyName(options: { fonts: string[]; input: string }): string {
  const input = options.input.trim();
  if (!input) return "";
  const q = normalize(input);

  const fonts = Array.isArray(options.fonts) ? options.fonts : [];
  const byLower = new Map(fonts.map((name) => [normalize(name), name] as const));
  const direct = byLower.get(q);
  if (direct) return direct;

  for (const spec of ALIAS_SPECS) {
    if (!spec.aliases.some((a) => normalize(a) === q)) continue;
    const existing = findExistingCandidates(fonts, spec.candidates);
    const best = existing[0];
    if (best) return best;
  }

  return input;
}
