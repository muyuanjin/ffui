// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import AppExitConfirmDialog from "@/components/dialogs/AppExitConfirmDialog.vue";

const resetExitPrompt = vi.fn(async () => {});
const exitAppNow = vi.fn(async () => {});
const exitAppWithAutoWait = vi.fn(async () => ({
  requestedJobCount: 1,
  completedJobCount: 1,
  timedOutJobCount: 0,
  timeoutSeconds: 5,
}));

vi.mock("@/lib/backend", () => {
  return {
    resetExitPrompt: () => resetExitPrompt(),
    exitAppNow: () => exitAppNow(),
    exitAppWithAutoWait: () => exitAppWithAutoWait(),
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

describe("AppExitConfirmDialog", () => {
  beforeEach(() => {
    resetExitPrompt.mockClear();
    exitAppNow.mockClear();
    exitAppWithAutoWait.mockClear();
    document.body.innerHTML = "";
  });

  it("cancels and resets backend exit prompt", async () => {
    const wrapper = mount(AppExitConfirmDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        processingJobCount: 2,
        timeoutSeconds: 5,
      },
    });

    await flushPromises();
    const cancel = document.body.querySelector('[data-testid="exit-confirm-cancel"]') as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    cancel?.click();
    await flushPromises();
    expect(resetExitPrompt).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);

    wrapper.unmount();
  });

  it("invokes auto-wait exit", async () => {
    const wrapper = mount(AppExitConfirmDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        processingJobCount: 1,
        timeoutSeconds: 5,
      },
    });

    await flushPromises();
    const pauseExit = document.body.querySelector(
      '[data-testid="exit-confirm-pause-and-exit"]',
    ) as HTMLButtonElement | null;
    expect(pauseExit).not.toBeNull();
    pauseExit?.click();
    await flushPromises();
    expect(exitAppWithAutoWait).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("invokes immediate exit", async () => {
    const wrapper = mount(AppExitConfirmDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        processingJobCount: 1,
        timeoutSeconds: 5,
      },
    });

    await flushPromises();
    const exitNow = document.body.querySelector('[data-testid="exit-confirm-exit-now"]') as HTMLButtonElement | null;
    expect(exitNow).not.toBeNull();
    exitNow?.click();
    await flushPromises();
    expect(exitAppNow).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("shows infinite timeout hint when timeoutSeconds <= 0", async () => {
    const wrapper = mount(AppExitConfirmDialog, {
      global: { plugins: [i18n] },
      props: {
        open: true,
        processingJobCount: 1,
        timeoutSeconds: 0,
      },
    });

    await flushPromises();
    expect(document.body.textContent).toContain("将无限等待，直到任务暂停完成。");

    wrapper.unmount();
  });
});
