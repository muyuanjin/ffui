// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";

let resolveAppSettings: ((settings: any) => void) | null = null;

const listenMock = vi.fn<(event: string, handler: (event: any) => void) => Promise<() => void>>();

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: (...args: Parameters<typeof listenMock>) => listenMock(...args),
  };
});

vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: () => ({
      show: vi.fn(async () => {}),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }),
  };
});

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  const loadAppSettings = vi.fn(
    () =>
      new Promise<any>((resolve) => {
        resolveAppSettings = resolve;
      }),
  );
  const saveAppSettings = vi.fn(async (settings: any) => settings);

  return {
    ...actual,
    hasTauri: () => true,
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision ? `${path}?ffuiPreviewRev=${revision}` : path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({}) as any),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({}) as any),
    loadAppSettings,
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadPresets: vi.fn(async () => []),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings,
    enqueueTranscodeJob: vi.fn(async () => ({}) as any),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob, AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";
import { saveAppSettings as saveAppSettingsMock } from "@/lib/backend";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const queueItemStub = {
  props: ["job", "preset", "canCancel", "viewMode", "progressStyle"],
  template: `<div data-testid="queue-item-stub" :data-job-id="job.id">{{ job.filename }}</div>`,
};

function setJobs(vm: any, jobs: TranscodeJob[]) {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MainApp queue selection toolbar pin", () => {
  beforeEach(() => {
    (window as any).__TAURI__ = {};
    resolveAppSettings = null;
    listenMock.mockReset();
    listenMock.mockImplementation(async () => {
      return () => {};
    });
  });

  it("keeps the toolbar pinned even if AppSettings load completes later with selectionBarPinned=false", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: queueItemStub,
        },
      },
    });

    const vm: any = withMainAppVmCompat(wrapper);
    // 先让队列初始轮询等异步逻辑完成，避免之后我们手动设置的 jobs 被覆盖回空列表。
    await flushPromises();
    vm.activeTab = "queue";

    const jobs: TranscodeJob[] = [
      {
        id: "job-1",
        filename: "C:/videos/a.mp4",
        type: "video",
        source: "manual",
        originalSizeMB: 10,
        originalCodec: "h264",
        presetId: "p1",
        status: "queued",
        progress: 0,
        logs: [],
      },
    ];

    setJobs(vm, jobs);
    await nextTick();

    // 选中队列中的任务以显示选择操作栏。
    if (typeof vm.selectAllVisibleJobs === "function") {
      vm.selectAllVisibleJobs();
    }
    await nextTick();

    const secondary = wrapper.get("[data-testid='queue-secondary-header']");

    // 初始状态下按钮应为“固定工具栏”。
    const pinButton = secondary.get('button[title="Pin toolbar"]');

    // 在 AppSettings 真正加载完成之前先点击固定按钮。
    await pinButton.trigger("click");
    await nextTick();
    await flushPromises();

    // UI 上应立即切换为“取消固定”。
    expect(secondary.find('button[title="Unpin toolbar"]').exists()).toBe(true);

    // 此时模拟后端设置晚到且带有 selectionBarPinned=false。
    const backendSettings: AppSettings = {
      tools: {
        ffmpegPath: undefined,
        ffprobePath: undefined,
        avifencPath: undefined,
        autoDownload: false,
        autoUpdate: false,
        downloaded: undefined,
      },
      batchCompressDefaults: buildBatchCompressDefaults(),
      previewCapturePercent: 25,
      developerModeEnabled: false,
      defaultQueuePresetId: undefined,
      presetSortMode: undefined,
      presetViewMode: undefined,
      maxParallelJobs: undefined,
      progressUpdateIntervalMs: undefined,
      metricsIntervalMs: undefined,
      taskbarProgressMode: "byEstimatedTime",
      queuePersistenceMode: "none",
      onboardingCompleted: false,
      selectionBarPinned: false,
    };

    resolveAppSettings?.(backendSettings);
    await flushPromises();
    await nextTick();

    const secondaryAfter = wrapper.get("[data-testid='queue-secondary-header']");

    // 加载设置后仍应保持已固定状态，按钮为“取消固定”。
    expect(secondaryAfter.find('button[title="Unpin toolbar"]').exists()).toBe(true);

    const appSettings = (vm.settings?.appSettings?.value as AppSettings | null) ?? null;
    expect(appSettings?.selectionBarPinned).toBe(true);
    expect((saveAppSettingsMock as any).mock.calls.some((call: any[]) => call?.[0]?.selectionBarPinned === true)).toBe(
      true,
    );

    wrapper.unmount();
  });
});
