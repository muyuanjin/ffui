// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { QueueStartupHint } from "@/types";
import { useQueueStartupToast } from "./useQueueStartupToast";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const toastMessageMock = vi.fn();

vi.mock("vue-sonner", () => {
  return {
    toast: {
      message: (...args: any[]) => toastMessageMock(...args),
    },
  };
});

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
  };
});

const getQueueStartupHintMock = vi.fn<() => Promise<QueueStartupHint | null>>();
const resumeStartupQueueMock = vi.fn<() => Promise<number>>();

vi.mock("@/lib/backend.queue-startup", () => {
  return {
    getQueueStartupHint: () => getQueueStartupHintMock(),
    resumeStartupQueue: () => resumeStartupQueueMock(),
  };
});

describe("useQueueStartupToast", () => {
  beforeEach(() => {
    toastMessageMock.mockReset();
    getQueueStartupHintMock.mockReset();
    resumeStartupQueueMock.mockReset();
  });

  it("shows a toast and resumes the startup queue via action button", async () => {
    getQueueStartupHintMock.mockResolvedValueOnce({ kind: "crashOrKill", autoPausedJobCount: 2 });
    resumeStartupQueueMock.mockResolvedValueOnce(2);

    const jobs = ref<any[]>([]);
    const lastQueueSnapshotRevision = ref<number | null>(null);
    const refreshQueueFromBackend = vi.fn(async () => {});
    const t = (key: string) => key;

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
    lastQueueSnapshotRevision.value = 1;
    await nextTick();
    await flushPromises();

    expect(getQueueStartupHintMock).toHaveBeenCalledTimes(1);
    expect(toastMessageMock).toHaveBeenCalledTimes(1);

    const [, options] = toastMessageMock.mock.calls[0];
    expect(options).toMatchObject({
      description: "queue.startupHint.descriptionCrashOrKill",
    });

    options.action.onClick();
    await flushPromises();

    expect(resumeStartupQueueMock).toHaveBeenCalledTimes(1);
    expect(refreshQueueFromBackend).toHaveBeenCalledTimes(1);
  });

  it("no-ops when disabled", async () => {
    getQueueStartupHintMock.mockResolvedValueOnce({ kind: "normalRestart", autoPausedJobCount: 2 });
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
    lastQueueSnapshotRevision.value = 1;
    await nextTick();
    await flushPromises();

    expect(getQueueStartupHintMock).not.toHaveBeenCalled();
    expect(toastMessageMock).not.toHaveBeenCalled();
  });
});
