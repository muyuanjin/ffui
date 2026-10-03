import { describe, expect, it } from "vitest";
import { rebaseAppSettings } from "./appSettingsChanges";
import { buildWebFallbackAppSettings } from "@/composables/appSettingsWebFallback";
import type { AppSettings } from "@/types";

const defaultAppSettings = (patch: Partial<AppSettings>): AppSettings => ({
  ...buildWebFallbackAppSettings(),
  ...patch,
});

describe("settings confirmation rebasing", () => {
  it("preserves backend confirmation while applying edits made during the save", () => {
    const before = defaultAppSettings({ defaultQueuePresetId: "audio" });
    const draft = { ...before, defaultQueuePresetId: "video" };
    const confirmed = { ...before, locale: "zh-CN", maxParallelJobs: 4 };
    expect(rebaseAppSettings(before, draft, confirmed)).toMatchObject({
      defaultQueuePresetId: "video",
      locale: "zh-CN",
      maxParallelJobs: 4,
    });
    expect(before.defaultQueuePresetId).toBe("audio");
  });

  it("replaces a mode and removes cleared values without restoring the previous branch", () => {
    const before = defaultAppSettings({ queuePresetSelection: { mode: "byMedia", audio: "music" }, locale: "en" });
    const draft = { ...before, queuePresetSelection: { mode: "unified" as const }, locale: undefined };
    const confirmed = { ...before, maxParallelJobs: 3 };
    const merged = rebaseAppSettings(before, draft, confirmed);
    expect(merged.queuePresetSelection).toEqual({ mode: "unified" });
    expect(merged.locale).toBeUndefined();
    expect(merged.maxParallelJobs).toBe(3);
  });
});
