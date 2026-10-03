// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { DialogContent as RekaDialogContent } from "reka-ui";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

describe("output settings nested select dismissal", () => {
  it.each(
    ["en", "zh-CN"].flatMap((locale) => [
      ...["container-mode-trigger", "directory-mode-trigger", "video-format", "audio-format", "image-format"].map(
        (selector) => ({ locale, mode: "byMedia" as const, selector }),
      ),
      ...["container-mode-trigger", "directory-mode-trigger", "container-format"].map((selector) => ({
        locale,
        mode: "force" as const,
        selector,
      })),
    ]),
  )("keeps $locale settings and $mode values when cancelling $selector", async ({ locale, mode, selector }) => {
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
          container:
            mode === "byMedia"
              ? { mode: "byMedia", video: "mkv", audio: "mp3", image: "png" }
              : { mode: "force", format: "mp3" },
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
    const field = dialog!.querySelector(`[data-testid="output-policy-${selector}"]`)!;
    const trigger = field.matches('[role="combobox"]') ? field : field.querySelector('[role="combobox"]')!;
    const original = trigger.textContent;
    for (const target of ["overlay", "blank", "escape"]) {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await flushPromises();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      expect(document.querySelector('[role="listbox"]')).not.toBeNull();
      const originalEvent =
        target === "escape"
          ? new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
          : new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              button: 0,
              pointerType: "mouse",
            });
      const outside = target === "overlay" ? document.querySelector('[data-testid="dialog-overlay"]')! : dialog!;
      if (target === "escape") document.activeElement!.dispatchEvent(originalEvent);
      else outside.dispatchEvent(originalEvent);
      await flushPromises();
      await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull());
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(trigger.textContent).toBe(original);
      expect(wrapper.emitted("update:queueOutputPolicy")).toBeUndefined();
      if (target !== "escape") {
        const delayedParentEvent = new CustomEvent("dismissableLayer.pointerDownOutside", {
          cancelable: true,
          detail: { originalEvent },
        });
        wrapper.findComponent(RekaDialogContent).vm.$emit("pointerDownOutside", delayedParentEvent);
        expect(delayedParentEvent.defaultPrevented).toBe(true);
      }
    }
    document
      .querySelector('[data-testid="dialog-overlay"]')!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
});
