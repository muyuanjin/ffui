// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import QueueStartupResumeDialog from "@/components/dialogs/QueueStartupResumeDialog.vue";

const resumeStartupQueue = vi.fn(async () => 3);
const dismissQueueStartupHint = vi.fn(async () => {});
const resumeTranscodeJobsBulk = vi.fn(async (jobIds: string[]) => Boolean(jobIds));

vi.mock("@/lib/backend.queue-startup", () => {
  return {
    resumeStartupQueue: () => resumeStartupQueue(),
    dismissQueueStartupHint: () => dismissQueueStartupHint(),
  };
});

vi.mock("@/lib/backend", () => {
  return {
    resumeTranscodeJobsBulk: (jobIds: string[]) => resumeTranscodeJobsBulk(jobIds),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": zhCN as any,
  },
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("QueueStartupResumeDialog", () => {
  beforeEach(() => {
    resumeStartupQueue.mockClear();
    dismissQueueStartupHint.mockClear();
    resumeTranscodeJobsBulk.mockClear();
    document.body.innerHTML = "";
  });

  it("resumes and refreshes queue when the primary button is clicked", async () => {
    const refreshQueueFromBackend = vi.fn(async () => {});
    const wrapper = mount(QueueStartupResumeDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        kind: "pausedQueue",
        autoPausedJobCount: 3,
        refreshQueueFromBackend,
      },
    });

    await flushPromises();
    const resume = document.body.querySelector('[data-testid="queue-startup-resume"]') as HTMLButtonElement | null;
    expect(resume).not.toBeNull();
    resume?.click();
    await flushPromises();

    expect(resumeStartupQueue).toHaveBeenCalledTimes(1);
    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);

    wrapper.unmount();
  });

  it("dismisses the hint when the dismiss button is clicked", async () => {
    const wrapper = mount(QueueStartupResumeDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        kind: "pauseOnExit",
        autoPausedJobCount: 2,
        refreshQueueFromBackend: null,
      },
    });

    await flushPromises();
    const dismiss = document.body.querySelector('[data-testid="queue-startup-dismiss"]') as HTMLButtonElement | null;
    expect(dismiss).not.toBeNull();
    dismiss?.click();
    await flushPromises();

    expect(dismissQueueStartupHint).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);

    wrapper.unmount();
  });

  it("falls back to bulk resume when startup auto-paused list is empty", async () => {
    resumeStartupQueue.mockResolvedValueOnce(0);
    resumeTranscodeJobsBulk.mockResolvedValueOnce(true);

    const refreshQueueFromBackend = vi.fn(async () => {});
    const wrapper = mount(QueueStartupResumeDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        kind: "pausedQueue",
        autoPausedJobCount: 1,
        pausedJobIds: ["job-6"],
        refreshQueueFromBackend,
      },
    });

    await flushPromises();
    const resume = document.body.querySelector('[data-testid="queue-startup-resume"]') as HTMLButtonElement | null;
    expect(resume).not.toBeNull();
    resume?.click();
    await flushPromises();

    expect(resumeStartupQueue).toHaveBeenCalledTimes(1);
    expect(resumeTranscodeJobsBulk).toHaveBeenCalledTimes(1);
    expect(resumeTranscodeJobsBulk).toHaveBeenCalledWith(["job-6"]);
    expect(dismissQueueStartupHint).toHaveBeenCalledTimes(1);
    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);

    wrapper.unmount();
  });
});
