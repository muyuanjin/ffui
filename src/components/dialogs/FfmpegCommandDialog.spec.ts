// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "vue-i18n";
import en from "@/locales/en";
import zh from "@/locales/zh-CN";
import FfmpegCommandDialog from "./FfmpegCommandDialog.vue";

const enqueue = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/backend", () => ({ enqueueFfmpegJob: enqueue }));

const createWrapper = () => {
  enqueue.mockClear();
  return mount(FfmpegCommandDialog, {
    props: { open: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en, "zh-CN": zh } })],
      stubs: {
        Dialog: { template: "<div><slot /></div>" },
        DialogContent: { template: "<div><slot /></div>" },
        DialogTitle: { template: "<h2><slot /></h2>" },
        DialogDescription: { template: "<p><slot /></p>" },
      },
    },
  });
};

describe("FFmpeg command dialog", () => {
  it("enqueues a lossless argv without a shell or preset", async () => {
    const wrapper = createWrapper();
    const args = ["-i", "C:\\音乐\\track.wav", "-metadata", "", "-map", "0", "-map", "0", "-f", "null", "NUL"];
    await wrapper.get('[data-testid="ffmpeg-command-name"]').setValue("Analysis");
    await wrapper.get('[data-testid="ffmpeg-command-args"]').setValue(JSON.stringify(args));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(enqueue).toHaveBeenCalledWith({ name: "Analysis", args, workingDirectory: null });
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it.each(["not json", '[["-version"]]', '["-i", 1]', "[]"])("rejects invalid argument arrays: %s", async (args) => {
    const wrapper = createWrapper();
    await wrapper.get('[data-testid="ffmpeg-command-name"]').setValue("Analysis");
    await wrapper.get('[data-testid="ffmpeg-command-args"]').setValue(args);
    await wrapper.get("form").trigger("submit");
    expect(enqueue).not.toHaveBeenCalled();
    expect(wrapper.get('[role="alert"]').text()).toBe(en.queue.command.invalid);
  });
});
