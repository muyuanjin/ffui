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
  it.each(["exit-confirm-exit-now", "exit-confirm-pause-and-exit"])(
    "restores cancel and retry after settings flush times out for %s",
    async (action) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const wrapper = mount(AppExitConfirmDialog, {
        global: { plugins: [i18n] },
        props: {
          open: true,
          processingJobCount: 1,
          timeoutSeconds: 5,
          flushSettings: () => new Promise<void>(() => {}),
        },
      });
      await flushPromises();
      (document.body.querySelector(`[data-testid="${action}"]`) as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(exitAppNow).not.toHaveBeenCalled();
      expect(exitAppWithAutoWait).not.toHaveBeenCalled();
      const cancel = document.body.querySelector('[data-testid="exit-confirm-cancel"]') as HTMLButtonElement;
      expect(cancel.disabled).toBe(false);
      expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("设置尚未保存成功");
      cancel.click();
      await flushPromises();
      expect(resetExitPrompt).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      consoleError.mockRestore();
    },
  );
  it.each(["exit-confirm-exit-now", "exit-confirm-pause-and-exit"])(
    "waits for settings persistence before %s",
    async (action) => {
      let finish!: () => void;
      const flushSettings = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const wrapper = mount(AppExitConfirmDialog, {
        global: { plugins: [i18n] },
        props: { open: true, processingJobCount: 1, timeoutSeconds: 5, flushSettings },
      });
      await flushPromises();
      (document.body.querySelector(`[data-testid="${action}"]`) as HTMLButtonElement).click();
      await flushPromises();
      expect(flushSettings).toHaveBeenCalledTimes(1);
      expect(exitAppNow).not.toHaveBeenCalled();
      expect(exitAppWithAutoWait).not.toHaveBeenCalled();
      finish();
      await flushPromises();
      expect(action === "exit-confirm-exit-now" ? exitAppNow : exitAppWithAutoWait).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    },
  );
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

  it("prevents duplicate pause-and-exit clicks while working", async () => {
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
    pauseExit?.click();
    await flushPromises();

    expect(exitAppWithAutoWait).toHaveBeenCalledTimes(1);
    expect(pauseExit?.disabled).toBe(true);

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
