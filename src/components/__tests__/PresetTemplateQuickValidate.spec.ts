// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import type { PresetTemplateValidationResult, FFmpegPreset } from "@/types";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMock.invoke,
  convertFileSrc: (path: string) => path,
}));

import ParameterWizard from "@/components/ParameterWizard.vue";
import UltimateParameterPanel from "@/components/UltimateParameterPanel.vue";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;

const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});
const t = (key: string, params?: any) => String(i18n.global.t(key, params));

const flushPromises = async () => {
  await new Promise((r) => setTimeout(r, 0));
};

describe("Preset template quick validation", () => {
  it("invokes validate_preset_template from the preset wizard custom command surface", async () => {
    let resolveInvoke: (value: PresetTemplateValidationResult) => void;
    const deferred = new Promise<PresetTemplateValidationResult>((resolve) => {
      resolveInvoke = resolve;
    });

    tauriCoreMock.invoke.mockImplementation((cmd: string) => {
      if (cmd === "validate_preset_template") return deferred;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const wrapper = mount(ParameterWizard, {
      props: {
        initialPreset: null,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.get("[data-testid='preset-kind-custom']").trigger("click");

    const nextLabel = t("common.next");
    const nextButton = wrapper.findAll("button").find((btn) => btn.text().includes(nextLabel));
    expect(nextButton).toBeTruthy();
    await nextButton!.trigger("click");

    const validateLabel = t("presetEditor.advanced.quickValidateButton");
    const validateButton = wrapper.findAll("button").find((btn) => btn.text().includes(validateLabel));
    expect(validateButton).toBeTruthy();
    await validateButton!.trigger("click");

    expect(tauriCoreMock.invoke).toHaveBeenCalled();
    const [cmd, payload] = tauriCoreMock.invoke.mock.calls[0] ?? [];
    expect(cmd).toBe("validate_preset_template");
    expect(payload).toHaveProperty("preset");
    expect((payload as any).preset.ffmpegTemplate).toContain("INPUT");
    expect((payload as any).preset.ffmpegTemplate).toContain("OUTPUT");

    expect(wrapper.text()).toContain(t("presetEditor.advanced.quickValidate.running"));

    resolveInvoke!({ outcome: "ok" });
    await flushPromises();

    expect(wrapper.text()).toContain(t("presetEditor.advanced.quickValidate.ok"));
  });

  it("invokes validate_preset_template from the ultimate parameter panel template tab", async () => {
    tauriCoreMock.invoke.mockReset();
    tauriCoreMock.invoke.mockResolvedValueOnce({ outcome: "ok" } satisfies PresetTemplateValidationResult);

    const preset: FFmpegPreset = {
      id: "p-test",
      name: "Test Preset",
      description: "",
      video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
      audio: { codec: "copy" },
      filters: {},
      stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
      advancedEnabled: true,
      ffmpegTemplate: "ffmpeg -hide_banner -i INPUT -c:v libx264 -c:a copy OUTPUT",
    };

    const wrapper = mount(UltimateParameterPanel, {
      props: { initialPreset: preset },
      global: { plugins: [i18n] },
    });

    const validateLabel = t("presetEditor.advanced.quickValidateButton");
    const validateButton = wrapper.findAll("button").find((btn) => btn.text().includes(validateLabel));
    expect(validateButton).toBeTruthy();

    await validateButton!.trigger("click");

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
      "validate_preset_template",
      expect.objectContaining({
        preset: expect.any(Object),
      }),
    );
    await flushPromises();
    expect(wrapper.text()).toContain(t("presetEditor.advanced.quickValidate.ok"));
  });
});
