// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import type { AppSettings, PresetSortDirection, PresetSortMode, PresetViewMode } from "@/types";
import { usePresetPanelModePersistence } from "./usePresetPanelModePersistence";
import { buildBatchCompressDefaults } from "@/__tests__/helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => ({ hasTauri: () => true }));

const makeSettings = (): AppSettings => ({
  tools: { autoDownload: false, autoUpdate: false },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  presetSortMode: "manual",
  presetViewMode: "grid",
});

const harness = (initial: AppSettings | null) => {
  const presetSortMode = ref<PresetSortMode>("manual");
  const presetSortDirection = ref<PresetSortDirection>("desc");
  const presetViewMode = ref<PresetViewMode>("grid");
  const appSettings = ref(initial);
  const ensureAppSettingsLoaded = vi.fn(async () => {});
  const persistNow = vi.fn(async () => {});
  const wrapper = mount(
    defineComponent({
      setup() {
        usePresetPanelModePersistence({
          presetSortMode,
          presetSortDirection,
          presetViewMode,
          appSettings,
          ensureAppSettingsLoaded,
          persistNow,
        });
        return {};
      },
      template: "<div />",
    }),
  );
  return {
    wrapper,
    presetSortMode,
    presetSortDirection,
    presetViewMode,
    appSettings,
    ensureAppSettingsLoaded,
    persistNow,
  };
};

describe("preset panel preferences hydration", () => {
  it("keeps all three early edits in one loaded snapshot instead of overwriting sibling fields", async () => {
    const state = harness(null);
    state.presetSortMode.value = "name";
    state.presetSortDirection.value = "asc";
    state.presetViewMode.value = "compact";
    await nextTick();
    state.appSettings.value = makeSettings();
    await nextTick();
    await nextTick();
    expect(state.appSettings.value).toMatchObject({
      presetSortMode: "name",
      presetSortDirection: undefined,
      presetViewMode: "compact",
    });
    expect(state.presetSortMode.value).toBe("name");
    expect(state.presetSortDirection.value).toBe("asc");
    expect(state.presetViewMode.value).toBe("compact");
    expect(state.persistNow).toHaveBeenCalledTimes(1);
    expect(state.persistNow).toHaveBeenLastCalledWith(state.appSettings.value);
    state.wrapper.unmount();
  });

  it("restores the saved sort, direction and view without saving a hydration as a user edit", async () => {
    const state = harness(null);
    state.appSettings.value = {
      ...makeSettings(),
      presetSortMode: "usage",
      presetSortDirection: "asc",
      presetViewMode: "compact",
    };
    await nextTick();
    await nextTick();
    expect(state.presetSortMode.value).toBe("usage");
    expect(state.presetSortDirection.value).toBe("asc");
    expect(state.presetViewMode.value).toBe("compact");
    expect(state.persistNow).not.toHaveBeenCalled();
    state.wrapper.unmount();
  });
});
