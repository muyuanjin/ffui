// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { bootstrapAppLocale, normalizeToAppLocale } from "@/lib/bootstrapAppLocale";
import type { AppSettings } from "@/types";

const makeSettings = (locale?: string): AppSettings =>
  ({
    tools: {
      ffmpegPath: undefined,
      ffprobePath: undefined,
      avifencPath: undefined,
      autoDownload: false,
      autoUpdate: false,
    },
    batchCompressDefaults: {} as any,
    previewCapturePercent: 25,
    taskbarProgressMode: "byEstimatedTime",
    locale,
  }) as AppSettings;

describe("bootstrapAppLocale", () => {
  it("normalizes locale strings into AppLocale", () => {
    expect(normalizeToAppLocale("zh")).toBe("zh-CN");
    expect(normalizeToAppLocale("zh-TW")).toBe("zh-CN");
    expect(normalizeToAppLocale("zh-Hans-CN")).toBe("zh-CN");
    expect(normalizeToAppLocale("en")).toBe("en");
    expect(normalizeToAppLocale("en-US")).toBe("en");
    expect(normalizeToAppLocale("fr-FR")).toBeNull();
  });

  it("respects forced ffuiLocale query param and does not persist", async () => {
    const loadAppSettings = vi.fn(async () => makeSettings(undefined));
    const saveAppSettings = vi.fn(async (s: AppSettings) => s);

    const result = await bootstrapAppLocale({
      hasTauri: true,
      loadAppSettings,
      saveAppSettings,
      getSearch: () => "?ffuiLocale=zh-CN",
      getOsLocale: async () => "en-US",
      getNavigatorLocales: () => ["en-US"],
    });

    expect(result.locale).toBe("zh-CN");
    expect(result.source).toBe("forced");
    expect(result.persisted).toBe(false);
    expect(loadAppSettings).not.toHaveBeenCalled();
    expect(saveAppSettings).not.toHaveBeenCalled();
  });

  it("uses saved AppSettings.locale when present", async () => {
    const loadAppSettings = vi.fn(async () => makeSettings("en"));
    const saveAppSettings = vi.fn(async (s: AppSettings) => s);

    const result = await bootstrapAppLocale({
      hasTauri: true,
      loadAppSettings,
      saveAppSettings,
      getOsLocale: async () => "zh-CN",
      getNavigatorLocales: () => ["zh-CN"],
      getSearch: () => "",
    });

    expect(result.locale).toBe("en");
    expect(result.source).toBe("saved");
    expect(result.persisted).toBe(false);
    expect(saveAppSettings).not.toHaveBeenCalled();
  });

  it("uses plugin-os locale when no saved locale and persists once", async () => {
    const loadAppSettings = vi.fn(async () => makeSettings(undefined));
    const saveAppSettings = vi.fn(async (s: AppSettings) => s);

    const result = await bootstrapAppLocale({
      hasTauri: true,
      loadAppSettings,
      saveAppSettings,
      getOsLocale: async () => "zh-Hans-CN",
      getNavigatorLocales: () => ["en-US"],
      getSearch: () => "",
    });

    expect(result.locale).toBe("zh-CN");
    expect(result.source).toBe("plugin-os");
    expect(result.persisted).toBe(true);
    expect(saveAppSettings).toHaveBeenCalledTimes(1);
    const arg = saveAppSettings.mock.calls[0]?.[0] as AppSettings | undefined;
    expect(arg?.locale).toBe("zh-CN");
  });

  it("falls back to navigator.languages when plugin-os is unavailable and persists once", async () => {
    const loadAppSettings = vi.fn(async () => makeSettings(undefined));
    const saveAppSettings = vi.fn(async (s: AppSettings) => s);

    const result = await bootstrapAppLocale({
      hasTauri: true,
      loadAppSettings,
      saveAppSettings,
      getOsLocale: async () => null,
      getNavigatorLocales: () => ["zh-TW", "en-US"],
      getSearch: () => "",
    });

    expect(result.locale).toBe("zh-CN");
    expect(result.source).toBe("navigator");
    expect(result.persisted).toBe(true);
    expect(saveAppSettings).toHaveBeenCalledTimes(1);
  });
});
