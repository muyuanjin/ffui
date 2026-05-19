export const FPS_CANONICAL_ALIAS_VALUES = ["film", "ntsc_film", "pal", "ntsc"] as const;
export const FPS_COMPAT_ALIAS_VALUES = ["ntsc-film"] as const;
export const FPS_ALIAS_VALUES = [...FPS_CANONICAL_ALIAS_VALUES, ...FPS_COMPAT_ALIAS_VALUES] as const;

export type FpsAlias = (typeof FPS_ALIAS_VALUES)[number];

export type FpsExpressionKind = "integer" | "decimal" | "rational" | "alias";

export interface ParsedFpsExpression {
  value: string;
  kind: FpsExpressionKind;
}

export interface FpsExpressionParseError {
  reason: "empty" | "legacyNumberNotFinite" | "nonPositive" | "divisionByZero" | "unsafeCharacters" | "invalidFormat";
  value: unknown;
}

export type FpsExpressionParseResult =
  | { ok: true; expression: ParsedFpsExpression }
  | { ok: false; error: FpsExpressionParseError };

const ALIAS_CANONICAL_VALUES: Record<FpsAlias, string> = {
  film: "film",
  ntsc_film: "ntsc_film",
  pal: "pal",
  ntsc: "ntsc",
  "ntsc-film": "24000/1001",
};
const UNSAFE_FILTERGRAPH_CHARS = /[\s,;()]/;
const INTEGER_PATTERN = /^[0-9]+$/;
const DECIMAL_PATTERN = /^[0-9]+\.[0-9]+$/;
const RATIONAL_PATTERN = /^([0-9]+)\/([0-9]+)$/;
const U128_MAX = (1n << 128n) - 1n;

const formatLegacyFpsNumber = (value: number): string => {
  if (value % 1 === 0) {
    return Number.isSafeInteger(value) ? value.toFixed(0) : value.toLocaleString("en-US", { useGrouping: false });
  }
  let raw = value.toFixed(12);
  while (raw.includes(".") && raw.endsWith("0")) {
    raw = raw.slice(0, -1);
  }
  if (raw.endsWith(".")) {
    raw = raw.slice(0, -1);
  }
  return raw;
};

const parsePositiveNumberLiteral = (value: string): FpsExpressionParseResult => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: { reason: "legacyNumberNotFinite", value } };
  }
  if (parsed <= 0) {
    return { ok: false, error: { reason: "nonPositive", value } };
  }
  return {
    ok: true,
    expression: { value, kind: value.includes(".") ? "decimal" : "integer" },
  };
};

export const parseFpsExpression = (value: unknown): FpsExpressionParseResult => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { ok: false, error: { reason: "legacyNumberNotFinite", value } };
    }
    if (value <= 0) {
      return { ok: false, error: { reason: "nonPositive", value } };
    }
    const formatted = formatLegacyFpsNumber(value);
    return parsePositiveNumberLiteral(formatted);
  }

  if (typeof value !== "string") {
    return { ok: false, error: { reason: "invalidFormat", value } };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: { reason: "empty", value } };
  }
  if (UNSAFE_FILTERGRAPH_CHARS.test(trimmed)) {
    return { ok: false, error: { reason: "unsafeCharacters", value } };
  }
  if (Object.prototype.hasOwnProperty.call(ALIAS_CANONICAL_VALUES, trimmed)) {
    return { ok: true, expression: { value: ALIAS_CANONICAL_VALUES[trimmed as FpsAlias], kind: "alias" } };
  }
  if (INTEGER_PATTERN.test(trimmed) || DECIMAL_PATTERN.test(trimmed)) {
    return parsePositiveNumberLiteral(trimmed);
  }

  const rationalMatch = trimmed.match(RATIONAL_PATTERN);
  if (rationalMatch) {
    const numerator = BigInt(rationalMatch[1]);
    const denominator = BigInt(rationalMatch[2]);
    if (numerator <= 0n) {
      return { ok: false, error: { reason: "nonPositive", value } };
    }
    if (denominator <= 0n) {
      return { ok: false, error: { reason: "divisionByZero", value } };
    }
    if (numerator > U128_MAX || denominator > U128_MAX) {
      return { ok: false, error: { reason: "invalidFormat", value } };
    }
    return { ok: true, expression: { value: trimmed, kind: "rational" } };
  }

  return { ok: false, error: { reason: "invalidFormat", value } };
};

export const normalizeFpsExpressionForSave = (value: unknown): string | undefined => {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim().length === 0) return undefined;

  const parsed = parseFpsExpression(value);
  if (!parsed.ok) return undefined;
  return parsed.expression.value;
};

export const isValidFpsExpression = (value: unknown): boolean => parseFpsExpression(value).ok;
