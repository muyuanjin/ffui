// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import SmartPresetOnboardingWizard from "@/components/dialogs/SmartPresetOnboardingWizard.vue";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import type { FFmpegPreset } from "@/types";
import en from "@/locales/en";

// 通过可变数组提供 mock 数据，避免在 vi.mock 工厂中捕获未初始化变量。
let smartPresetsMock: FFmpegPreset[] = [];

vi.mock("@/lib/backend", () => ({
  loadSmartDefaultPresets: () => Promise.resolve(smartPresetsMock),
}));

// SmartPresetOnboardingWizard 间接依赖 ResizeObserver（通过 Slider 等组件），
// 在 jsdom 环境中提供一个简易 polyfill 避免挂载时报错。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// 为测试构建一个最小的 i18n 实例，复用完整英文文案，避免出现缺失 key 的告警。
const i18n = (createI18n as any)({
  legacy: false,
  locale: "en",
  messages: { en: en as any },
});

describe("SmartPresetOnboardingWizard", () => {
  beforeEach(() => {
    smartPresetsMock = [];
  });

  it("does not auto-select advanced presets such as constqp18 AV1 and AMF/QSV when entering presets step", async () => {
    const presets: FFmpegPreset[] = [
      {
        id: "smart-hevc-balanced",
        name: "H.265 Balanced NVENC",
        description: "NVENC balanced CQ26 p7",
        video: {
          encoder: "hevc_nvenc",
          rateControl: "cq",
          qualityValue: 26,
          preset: "p7",
        } as any,
        audio: { codec: "copy" } as any,
        filters: {} as any,
        stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
      },
      {
        id: "smart-av1-nvenc-hq-constqp18",
        name: "AV1 NVENC HQ ConstQP18",
        description: "视觉无损 AV1 constqp18",
        video: {
          encoder: "av1_nvenc",
          rateControl: "constqp",
          qualityValue: 18,
          preset: "p7",
        } as any,
        audio: { codec: "copy" } as any,
        filters: {} as any,
        stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
      },
      {
        id: "smart-hevc-amf-balanced",
        name: "H.265 Balanced (AMF)",
        description: "AMD AMF HEVC qp28 balanced",
        video: {
          encoder: "hevc_amf",
          rateControl: "cq",
          qualityValue: 28,
          preset: "balanced",
        } as any,
        audio: { codec: "copy" } as any,
        filters: {} as any,
        stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
      },
    ];

    smartPresetsMock = presets;

    const wrapper = mount(SmartPresetOnboardingWizard, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
    });

    // 等待预设加载完成
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const t = (key: string) => i18n.global.t(key);
    // welcome -> codec -> useCase -> presets，一共点击三次 Next
    for (let i = 0; i < 3; i += 1) {
      const nextButton = wrapper.get("[data-testid='preset-setup-wizard-next']");
      expect(nextButton.text()).toContain(t("common.next"));
      await nextButton.trigger("click");
      await nextTick();
    }

    // 此时处于 presets 步骤，watch(currentStep) 已根据 isAdvancedPreset 进行了默认勾选。
    const cards = wrapper.findAllComponents(Card);
    expect(cards.length).toBeGreaterThanOrEqual(3);

    const findCardByText = (keyword: string) => {
      return cards.find((card) => card.text().includes(keyword));
    };

    const balancedCard = findCardByText("H.265 Balanced NVENC");
    const av1ConstqpCard = findCardByText("AV1 NVENC HQ ConstQP18");
    const amfCard = findCardByText("H.265 Balanced (AMF)");

    expect(balancedCard).toBeTruthy();
    expect(av1ConstqpCard).toBeTruthy();
    expect(amfCard).toBeTruthy();

    const balancedCheckbox = balancedCard!.findComponent(Checkbox);
    const av1Checkbox = av1ConstqpCard!.findComponent(Checkbox);
    const amfCheckbox = amfCard!.findComponent(Checkbox);

    // 主流 NVENC 平衡预设应当默认勾选
    expect(balancedCheckbox.attributes("data-state")).toBe("checked");
    // 高阶/实验向 AV1 ConstQP18 以及 AMF 预设默认不勾选
    expect(av1Checkbox.attributes("data-state")).not.toBe("checked");
    expect(amfCheckbox.attributes("data-state")).not.toBe("checked");

    // 卡片上应展示场景标签与体积风险提示
    // Balanced 预设为日常/分享类，不应带“May increase size”风险徽标
    expect(balancedCard!.text()).toContain("Daily viewing");
    expect(balancedCard!.text()).not.toContain("May increase size");
    // ConstQP18 视觉无损 AV1 预设应标记为“Visually (near) lossless”，并带体积风险徽标
    expect(av1ConstqpCard!.text()).toContain("Visually (near) lossless");
    expect(av1ConstqpCard!.text()).toContain("May increase size");

    wrapper.unmount();
  });

  it("does not treat QSV/AMF-only environments as having NVENC available", async () => {
    // 仅提供 AMF 预设，模拟“只有 AMD AMF、没有 NVENC”的环境
    smartPresetsMock = [
      {
        id: "smart-hevc-amf-balanced",
        name: "H.265 Balanced (AMF)",
        description: "AMD dGPU/APU：HEVC AMF qp28 preset balanced，快速兼顾体积（质量次之）。",
        video: {
          encoder: "hevc_amf",
          rateControl: "cq",
          qualityValue: 28,
          preset: "balanced",
        } as any,
        audio: { codec: "copy" } as any,
        filters: {} as any,
        stats: {
          usageCount: 0,
          totalInputSizeMB: 0,
          totalOutputSizeMB: 0,
          totalTimeSeconds: 0,
        },
      } as FFmpegPreset,
    ];

    const wrapper = mount(SmartPresetOnboardingWizard, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
    });

    await nextTick();
    await Promise.resolve();
    await nextTick();

    const t = (key: string) => i18n.global.t(key);
    const nvencNotDetected = t("onboarding.nvencNotDetected");

    expect(wrapper.text()).toContain(nvencNotDetected);

    wrapper.unmount();
  });
});
