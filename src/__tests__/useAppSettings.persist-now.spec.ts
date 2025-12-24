// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import type { AppSettings, ExternalToolStatus } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadAppSettings: vi.fn(),
    saveAppSettings: vi.fn(async (settings: AppSettings) => settings),
    fetchExternalToolStatusesCached: vi.fn(async () => [] as ExternalToolStatus[]),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchExternalToolCandidates: vi.fn(async () => []),
    downloadExternalToolNow: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => {
      return () => {};
    }),
  };
});

import { useAppSettings } from "@/composables/useAppSettings";
import * as backend from "@/lib/backend";

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  defaultQueuePresetId: undefined,
  maxParallelJobs: undefined,
  progressUpdateIntervalMs: undefined,
  metricsIntervalMs: undefined,
  taskbarProgressMode: "byEstimatedTime",
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const TestHost = defineComponent({
  setup() {
    return useAppSettings();
  },
  template: "<div />",
});

describe("useAppSettings.persistNow", () => {
  it("persists once and keeps the debounced saver from double-writing", async () => {
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockClear();

    await vm.persistNow(makeAppSettings());
    await flushPromises();
    await flushPromises();

    expect(saveMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("markSaved syncs the snapshot so a pending debounced save becomes a no-op", async () => {
    const wrapper = mount(TestHost);
    const vm = wrapper.vm as any;
    const saveMock = vi.mocked(backend.saveAppSettings);
    saveMock.mockClear();

    const settings = makeAppSettings();
    vm.appSettings = settings;
    vm.markSaved(settings);
    await flushPromises();
    await flushPromises();

    expect(saveMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
