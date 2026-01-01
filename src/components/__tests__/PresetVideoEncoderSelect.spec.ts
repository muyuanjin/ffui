// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { computed, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";

import PresetVideoEncoderSelect from "@/components/preset-editor/PresetVideoEncoderSelect.vue";

const ensurePointerCaptureApi = () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== "function") proto.hasPointerCapture = () => false;
  if (typeof proto.setPointerCapture !== "function") proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== "function") proto.releasePointerCapture = () => {};
};

describe("PresetVideoEncoderSelect", () => {
  it("selects an encoder and keeps disabled items non-interactive", async () => {
    ensurePointerCaptureApi();

    const i18n = (createI18n as any)({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          presetEditor: {
            video: {
              encoder: "Video Encoder",
              encoderHelp: "Help",
              encoderPlaceholder: "Choose encoder",
              encoderEmptyHint: "No encoders match this search.",
              encoderBadge: {
                hardware: "HW",
                software: "SW",
                hardwareTitle: "Hardware encoder",
                softwareTitle: "Software encoder",
              },
              encoderFilter: {
                h264: "H.264",
                h265: "H.265",
                av1: "AV1",
                copy: "Copy",
                other: "Other",
              },
            },
          },
        },
      },
    });

    type EncoderCodecTag = "h264" | "h265" | "av1" | "copy" | "other";

    type EncoderOption = {
      value: string;
      label: string;
      codecTag: EncoderCodecTag;
      hardware: boolean;
      disabled?: boolean;
      disabledReason?: string;
    };

    type EncoderGroup = {
      tag: EncoderCodecTag;
      options: EncoderOption[];
    };

    const groups: EncoderGroup[] = [
      {
        tag: "h264",
        options: [
          { value: "libx264", label: "H.264 Software (libx264)", codecTag: "h264", hardware: false },
          { value: "h264_nvenc", label: "H.264 NVIDIA (h264_nvenc)", codecTag: "h264", hardware: true },
        ],
      },
      {
        tag: "h265",
        options: [
          {
            value: "hevc_nvenc",
            label: "H.265 NVIDIA (hevc_nvenc)",
            codecTag: "h265",
            hardware: true,
            disabled: true,
            disabledReason: "Not available",
          },
          { value: "libx265", label: "H.265 Software (libx265)", codecTag: "h265", hardware: false },
        ],
      },
    ];

    const TestHost = {
      components: { PresetVideoEncoderSelect },
      setup() {
        const modelValue = ref<string | undefined>("libx264");
        const currentLabel = computed(() => {
          const cur = String(modelValue.value ?? "").trim();
          for (const group of groups) {
            const match = group.options.find((opt) => opt.value === cur);
            if (match) return match.label;
          }
          return "";
        });
        const onUpdate = (value: string) => {
          modelValue.value = value;
        };
        return { modelValue, currentLabel, groups, onUpdate };
      },
      template: `
        <PresetVideoEncoderSelect
          :model-value="modelValue"
          :current-label="currentLabel"
          :option-groups="groups"
          @update:model-value="onUpdate"
        />
      `,
    };

    const wrapper = mount(TestHost, { attachTo: document.body, global: { plugins: [i18n] } });

    const trigger = wrapper.get('[data-testid="preset-video-encoder-trigger"]');
    trigger.element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      }),
    );
    await nextTick();
    trigger.element.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await nextTick();

    const optionEls = Array.from(document.body.querySelectorAll('[role="option"]')) as HTMLElement[];
    const optionTexts = optionEls.map((el) => (el.textContent ?? "").replace(/\\s+/g, " ").trim());
    expect(optionTexts.some((t) => t.includes("h264_nvenc"))).toBe(true);
    expect(optionTexts.some((t) => t.includes("libx264"))).toBe(true);

    const optionNvenc = optionEls.find((el) => (el.textContent ?? "").includes("h264_nvenc"));
    expect(optionNvenc).toBeTruthy();

    optionNvenc!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      }),
    );
    optionNvenc!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await nextTick();
    await nextTick();

    expect((wrapper.vm as any).modelValue).toBe("h264_nvenc");

    const optionDisabled = optionEls.find((el) => (el.textContent ?? "").includes("hevc_nvenc"));
    expect(optionDisabled).toBeTruthy();
    expect(optionDisabled!.getAttribute("aria-disabled")).toBe("true");

    wrapper.unmount();
  });
});
