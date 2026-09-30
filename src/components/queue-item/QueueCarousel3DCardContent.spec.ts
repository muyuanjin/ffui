// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import en from "@/locales/en";
import QueueCarousel3DCardContent from "./QueueCarousel3DCardContent.vue";

describe("carousel command progress", () => {
  it.each(["managed", "transparent"] as const)(
    "uses indeterminate accessible progress for %s execution",
    (executionMode) => {
      const job: TranscodeJob = {
        id: "command",
        filename: "command",
        type: "other",
        source: "manual",
        status: "processing",
        progress: 42,
        originalSizeMB: 0,
        presetId: "snapshot",
        executionMode,
      };
      const wrapper = mount(QueueCarousel3DCardContent, {
        props: { item: { kind: "job", job }, previewUrl: null, displayFilename: "Command", selected: false },
        global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })] },
      });
      const indicator = wrapper.get('[data-testid="queue-item-progress-indeterminate"]');
      expect(indicator.attributes("role")).toBe("progressbar");
      expect(indicator.attributes("aria-valuenow")).toBeUndefined();
      expect(wrapper.text()).toContain(en.queue.command.indeterminate);
      expect(wrapper.text()).not.toContain("42%");
      expect(wrapper.findAll('[role="progressbar"]')).toHaveLength(1);
    },
  );
});
