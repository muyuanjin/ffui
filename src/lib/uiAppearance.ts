import type { UiFontFamily } from "@/types";

export const DEFAULT_UI_SCALE_PERCENT = 100;
export const MIN_UI_SCALE_PERCENT = 50;
export const MAX_UI_SCALE_PERCENT = 200;
export const DEFAULT_UI_FONT_FAMILY: UiFontFamily = "system";
export const DEFAULT_UI_FONT_SIZE_PERCENT = 100;
export const MIN_UI_FONT_SIZE_PERCENT = 60;
export const MAX_UI_FONT_SIZE_PERCENT = 200;

type UiScaleEngine = "zoom" | "transform";

function resolveUiScaleEngine(): UiScaleEngine {
  // Zoom scaling behaves inconsistently across platforms/webviews and can
  // reintroduce blank gaps or clipping; keep a single transform-based path.
  return "transform";
}

export function normalizeUiScalePercent(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_UI_SCALE_PERCENT;
  const rounded = Math.round(raw);
  return Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, rounded));
}

export function normalizeUiFontSizePercent(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_UI_FONT_SIZE_PERCENT;
  const rounded = Math.round(raw);
  return Math.min(MAX_UI_FONT_SIZE_PERCENT, Math.max(MIN_UI_FONT_SIZE_PERCENT, rounded));
}

export function normalizeUiFontFamily(value: unknown): UiFontFamily {
  if (value === "system" || value === "sans" || value === "mono") return value;
  return DEFAULT_UI_FONT_FAMILY;
}

export function normalizeUiFontName(value: unknown): string | null {
  if (value == null) return null;
  const name = String(value).trim();
  return name.length ? name : null;
}

function quoteCssFontFamilyName(name: string): string {
  // Most font family names are safe as-is; quote only when needed.
  if (/^[a-z0-9_-]+$/i.test(name)) return name;
  return `"${name.replace(/"/g, '\\"')}"`;
}

export function resolveUiFontFamilyStack(family: UiFontFamily): string {
  if (family === "mono") {
    return [
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Monaco",
      "Consolas",
      '"Liberation Mono"',
      '"Courier New"',
      "monospace",
    ].join(", ");
  }
  if (family === "sans") {
    return [
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      '"Segoe UI"',
      "Roboto",
      '"Helvetica Neue"',
      "Arial",
      '"Noto Sans"',
      '"Liberation Sans"',
      "sans-serif",
    ].join(", ");
  }
  // system
  return [
    "system-ui",
    "-apple-system",
    '"Segoe UI"',
    "Roboto",
    '"Helvetica Neue"',
    "Arial",
    '"Noto Sans"',
    '"Liberation Sans"',
    "sans-serif",
  ].join(", ");
}

export function applyUiAppearanceToDocument(options: {
  uiScalePercent?: unknown;
  uiFontSizePercent?: unknown;
  uiFontFamily?: unknown;
  uiFontName?: unknown;
}): { uiScalePercent: number; uiFontFamily: UiFontFamily; uiFontSizePercent: number } {
  const uiScalePercent = normalizeUiScalePercent(options.uiScalePercent);
  const uiFontSizePercent = normalizeUiFontSizePercent(options.uiFontSizePercent);
  const uiFontFamily = normalizeUiFontFamily(options.uiFontFamily);
  const uiFontName = normalizeUiFontName(options.uiFontName);

  if (typeof document !== "undefined") {
    const engine: UiScaleEngine = resolveUiScaleEngine();
    const fontStack = uiFontName
      ? `${quoteCssFontFamilyName(uiFontName)}, ${resolveUiFontFamilyStack("system")}`
      : resolveUiFontFamilyStack(uiFontFamily);
    const scale = uiScalePercent / 100;
    const inv = scale > 0 ? 1 / scale : 1;

    document.documentElement.style.setProperty("--ffui-ui-scale", String(scale));
    document.documentElement.style.setProperty("--ffui-ui-scale-inv", String(inv));
    document.documentElement.style.setProperty("--ffui-ui-font-family", fontStack);
    document.documentElement.style.setProperty("--ffui-ui-font-size-scale", String(uiFontSizePercent / 100));
    // Make the change visible immediately even if some CSS is overriding the
    // body rule or the webview delays variable propagation.
    if (document.body) {
      document.body.style.fontFamily = fontStack;
      document.body.style.fontSize = "";
    }
    document.documentElement.dataset.ffuiUiScale = String(uiScalePercent);
    document.documentElement.dataset.ffuiUiFontFamily = uiFontFamily;
    document.documentElement.dataset.ffuiUiFontSizePercent = String(uiFontSizePercent);

    document.documentElement.dataset.ffuiUiScaleEngine = engine;

    // Clear any inline zoom overrides; scaling is applied via CSS using the
    // dataset + CSS variables, so we keep this attribute-driven and consistent.
    document.documentElement.style.removeProperty("zoom");
  }

  return { uiScalePercent, uiFontFamily, uiFontSizePercent };
}
