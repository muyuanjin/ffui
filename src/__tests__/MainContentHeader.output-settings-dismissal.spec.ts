// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

describe("output settings nested format dismissal", () => {
  it.each(["en", "zh-CN"])(
    "keeps the %s settings dialog and formats when cancelling each media selector",
    async (locale) => {
      const wrapper = mount(MainContentHeader, {
        props: {
          activeTab: "queue",
          currentTitle: "Queue",
          currentSubtitle: "",
          jobsLength: 0,
          completedCount: 0,
          manualJobPresetId: null,
          presets: [],
          queueViewModeModel: "detail",
          queueOutputPolicy: {
            ...DEFAULT_OUTPUT_POLICY,
            container: { mode: "byMedia", video: "mkv", audio: "mp3", image: "png" },
          },
        },
        global: {
          plugins: [createI18n({ legacy: false, locale, messages: { en, "zh-CN": zhCN } })],
        },
      });
      await wrapper.get('[data-testid="ffui-queue-output-settings"]').trigger("click");
      await flushPromises();
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      for (const kind of ["video", "audio", "image"]) {
        const trigger = dialog!.querySelector(`[data-testid="output-policy-${kind}-format"] [role="combobox"]`)!;
        const original = trigger.textContent;
        for (const target of ["overlay", "blank"]) {
          trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
          await flushPromises();
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          expect(document.querySelector('[role="listbox"]')).not.toBeNull();
          const outside = target === "overlay" ? document.querySelector('[data-testid="dialog-overlay"]')! : dialog!;
          outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
          await flushPromises();
          await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
          expect(document.querySelector('[role="dialog"]')).toBe(dialog);
          expect(trigger.textContent).toBe(original);
          expect(wrapper.emitted("update:queueOutputPolicy")).toBeUndefined();
        }
      }
      dialog!.querySelector<HTMLButtonElement>("button:has(.sr-only)")!.click();
      await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    },
  );
});
