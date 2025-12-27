// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useQueueStartupToast } from "./useQueueStartupToast";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const toastMessageMock = vi.fn();

vi.mock("vue-sonner", () => {
  return {
    toast: {
      success: (...args: any[]) => toastMessageMock(...args),
    },
  };
});

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
  };
});

const resumeStartupQueueMock = vi.fn<() => Promise<number>>();
const getQueueStartupHintMock = vi.fn<() => Promise<any>>();
const dismissQueueStartupHintMock = vi.fn<() => Promise<void>>();

vi.mock("@/lib/backend.queue-startup", () => {
  return {
    resumeStartupQueue: () => resumeStartupQueueMock(),
    getQueueStartupHint: () => getQueueStartupHintMock(),
    dismissQueueStartupHint: () => dismissQueueStartupHintMock(),
  };
});

describe("useQueueStartupToast", () => {
  beforeEach(() => {
    toastMessageMock.mockReset();
    resumeStartupQueueMock.mockReset();
    getQueueStartupHintMock.mockReset();
    dismissQueueStartupHintMock.mockReset();
  });

  it("shows a corner toast after the first queue snapshot is loaded", async () => {
    resumeStartupQueueMock.mockResolvedValueOnce(2);
    getQueueStartupHintMock.mockResolvedValueOnce({ kind: "pauseOnExit", autoPausedJobCount: 2 });

    const jobs = ref<any[]>([
      { id: "job-1", status: "paused" },
      { id: "job-2", status: "paused" },
    ]);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const refreshQueueFromBackend = vi.fn(async () => {});
    const t = (key: string, params?: any) =>
      params
        ? `${key}:${Object.entries(params)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(",")}`
        : key;

    const TestHarness = defineComponent({
      setup() {
        useQueueStartupToast({
          enabled: true,
          t,
          jobs,
          lastQueueSnapshotRevision,
          refreshQueueFromBackend,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();
    await flushPromises();

    expect(toastMessageMock).not.toHaveBeenCalled();

    lastQueueSnapshotRevision.value = 1;
    await nextTick();
    await flushPromises();

    expect(toastMessageMock).toHaveBeenCalledTimes(1);
    const [title, opts] = toastMessageMock.mock.calls[0] ?? [];
    expect(title).toBe("queue.startupHint.title");
    expect(opts?.description).toContain("queue.startupHint.descriptionPauseOnExit");
    expect(opts?.action?.label).toBe("queue.startupHint.actionResumeTranscoding");
    expect(opts?.cancel?.label).toBe("queue.startupHint.close");

    opts?.action?.onClick?.();
    await flushPromises();
    expect(resumeStartupQueueMock).toHaveBeenCalledTimes(1);
    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
  });

  it("dismisses the backend hint when resumeStartupQueue resumes zero jobs", async () => {
    resumeStartupQueueMock.mockResolvedValueOnce(0);
    getQueueStartupHintMock.mockResolvedValueOnce({ kind: "crashOrKill", autoPausedJobCount: 2 });
    dismissQueueStartupHintMock.mockResolvedValueOnce();

    const jobs = ref<any[]>([
      { id: "job-3", status: "paused" },
      { id: "job-4", status: "paused" },
    ]);
    const lastQueueSnapshotRevision = ref<number | null>(1);
    const refreshQueueFromBackend = vi.fn(async () => {});

    const TestHarness = defineComponent({
      setup() {
        useQueueStartupToast({
          enabled: true,
          t: (key: string) => key,
          jobs,
          lastQueueSnapshotRevision,
          refreshQueueFromBackend,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();
    await flushPromises();

    const [, opts] = toastMessageMock.mock.calls[0] ?? [];
    opts?.action?.onClick?.();
    await flushPromises();
    expect(resumeStartupQueueMock).toHaveBeenCalledTimes(1);
    expect(dismissQueueStartupHintMock).toHaveBeenCalledTimes(1);
    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
  });

  it("no-ops when disabled", async () => {
    const jobs = ref<any[]>([]);
    const lastQueueSnapshotRevision = ref<number | null>(null);

    const TestHarness = defineComponent({
      setup() {
        useQueueStartupToast({
          enabled: false,
          t: (key: string) => key,
          jobs,
          lastQueueSnapshotRevision,
          refreshQueueFromBackend: async () => {},
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();
    await flushPromises();

    expect(toastMessageMock).not.toHaveBeenCalled();
  });

  it("does not show when the backend startup hint is empty (manual pause must not trigger)", async () => {
    getQueueStartupHintMock.mockResolvedValueOnce(null);

    const jobs = ref<any[]>([{ id: "job-1", status: "paused" }]);
    const lastQueueSnapshotRevision = ref<number | null>(1);

    const TestHarness = defineComponent({
      setup() {
        useQueueStartupToast({
          enabled: true,
          t: (key: string) => key,
          jobs,
          lastQueueSnapshotRevision,
          refreshQueueFromBackend: async () => {},
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();
    await flushPromises();

    expect(toastMessageMock).not.toHaveBeenCalled();
  });

  it("dismisses the backend hint when the cancel button is clicked", async () => {
    getQueueStartupHintMock.mockResolvedValueOnce({ kind: "pauseOnExit", autoPausedJobCount: 1 });
    const jobs = ref<any[]>([{ id: "job-5", status: "paused" }]);
    const lastQueueSnapshotRevision = ref<number | null>(1);
    const refreshQueueFromBackend = vi.fn(async () => {});
    dismissQueueStartupHintMock.mockResolvedValueOnce();

    const TestHarness = defineComponent({
      setup() {
        useQueueStartupToast({
          enabled: true,
          t: (key: string) => key,
          jobs,
          lastQueueSnapshotRevision,
          refreshQueueFromBackend,
        });
        return {};
      },
      template: "<div />",
    });

    mount(TestHarness);
    await nextTick();
    await flushPromises();

    const [, opts] = toastMessageMock.mock.calls[0] ?? [];
    opts?.cancel?.onClick?.();
    await flushPromises();
    expect(dismissQueueStartupHintMock).toHaveBeenCalledTimes(1);
  });
});
