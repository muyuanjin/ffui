// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import type { FFmpegPreset } from "@/types";

// 强制 Tauri 环境并用可控的 mock 返回后端预设列表。
const loadPresetsMock = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => true,
    loadPresets: (...args: any[]) => loadPresetsMock(...args),
  };
});

import { useMainAppPresets } from "./useMainAppPresets";

const makeCustomPreset = (): FFmpegPreset => ({
  id: "custom-1",
  name: "User Only",
  description: "user preset kept after deleting built-ins",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 20, preset: "slow" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("useMainAppPresets startup load", () => {
  it("使用后端返回的预设覆盖初始默认值，不会重新出现已删除的内置预设", async () => {
    loadPresetsMock.mockResolvedValueOnce([makeCustomPreset()]);

    const presets = ref<FFmpegPreset[]>([]);
    const presetsLoadedFromBackend = ref(false);
    const manualJobPresetId = ref<string | null>(null);
    const locale = ref("en");

    mount(
      defineComponent({
        setup() {
          useMainAppPresets({
            t: (key: string) => key,
            locale,
            presets,
            presetsLoadedFromBackend,
            manualJobPresetId,
            dialogManager: {
              openParameterPanel: () => {},
              closeParameterPanel: () => {},
              closeWizard: () => {},
            } as any,
            shell: undefined,
          });
          return {};
        },
        template: "<div></div>",
      }),
    );

    await flushPromises();

    expect(loadPresetsMock).toHaveBeenCalledTimes(1);
    expect(presets.value.map((p) => p.id)).toEqual(["custom-1"]);
    expect(manualJobPresetId.value).toBe("custom-1");
  });
});
