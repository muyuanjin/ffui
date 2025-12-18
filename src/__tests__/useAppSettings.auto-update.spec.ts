// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";

import type { AppSettings, ExternalToolStatus } from "@/types";

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
      // Return unlisten noop
      return () => {};
    }),
  };
});

import { useAppSettings } from "@/composables/useAppSettings";
import * as backend from "@/lib/backend";
import { buildSmartScanDefaults } from "./helpers/smartScanDefaults";

const makeAppSettings = (): AppSettings => ({
  tools: {
    ffmpegPath: undefined,
    ffprobePath: undefined,
    avifencPath: undefined,
    autoDownload: true,
    autoUpdate: true,
    downloaded: undefined,
  },
  smartScanDefaults: buildSmartScanDefaults(),
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

describe("useAppSettings auto-update behaviour", () => {
  it("propagates backend remoteVersion so the Settings panel shows the latest available release", async () => {
    const mockFetchExternalToolStatusesCached = vi.mocked(backend.fetchExternalToolStatusesCached);
    mockFetchExternalToolStatusesCached.mockResolvedValueOnce([
      {
        kind: "ffmpeg",
        resolvedPath: "C:/tools/ffmpeg.exe",
        source: "path",
        version: "ffmpeg version 6.0",
        remoteVersion: "6.1.1",
        updateAvailable: true,
        autoDownloadEnabled: true,
        autoUpdateEnabled: true,
        downloadInProgress: false,
        downloadProgress: undefined,
        downloadedBytes: undefined,
        totalBytes: undefined,
        bytesPerSecond: undefined,
        lastDownloadError: undefined,
        lastDownloadMessage: undefined,
      },
    ]);

    const wrapper = mount(TestHost);
    const vm = wrapper.vm as unknown as {
      toolStatuses: ExternalToolStatus[];
    };

    await flushPromises();
    expect(mockFetchExternalToolStatusesCached).toHaveBeenCalled();
    expect(vm.toolStatuses[0]?.remoteVersion).toBe("6.1.1");

    wrapper.unmount();
    mockFetchExternalToolStatusesCached.mockReset();
    mockFetchExternalToolStatusesCached.mockImplementation(async () => [] as ExternalToolStatus[]);
  });

  it("only schedules a single auto-download per remote version even if remoteVersion changes after the call", async () => {
    const mockDownloadExternalToolNow = vi.mocked(backend.downloadExternalToolNow);
    mockDownloadExternalToolNow.mockReset();

    const wrapper = mount(TestHost);
    const vm = wrapper.vm as unknown as {
      appSettings: AppSettings | null;
      toolStatuses: ExternalToolStatus[];
    };

    // Enable auto-update in settings.
    vm.appSettings = makeAppSettings();

    const initialStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "path",
      version: "ffmpeg version 5.0",
      remoteVersion: "6.0",
      updateAvailable: true,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: false,
      downloadProgress: undefined,
      downloadedBytes: undefined,
      totalBytes: undefined,
      bytesPerSecond: undefined,
      lastDownloadError: undefined,
      lastDownloadMessage: undefined,
    };

    const afterDownloadStatus: ExternalToolStatus = {
      ...initialStatus,
      // Simulate that backend has switched to a newer remote version tag
      // while still reporting updateAvailable=true for a short window.
      remoteVersion: "6.1",
      updateAvailable: true,
    };

    mockDownloadExternalToolNow.mockResolvedValue([afterDownloadStatus]);

    // First snapshot: updateAvailable + no download in progress.
    vm.toolStatuses = [initialStatus];
    await nextTick();
    await flushPromises();

    expect(mockDownloadExternalToolNow).toHaveBeenCalledTimes(1);

    // Allow the watcher to react once more to the updated statuses returned
    // from downloadExternalToolNow; it must not schedule a second download
    // just because remoteVersion changed from 6.0 -> 6.1.
    await nextTick();
    await flushPromises();

    expect(mockDownloadExternalToolNow).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("does not schedule auto-download when a download is already in progress for the same remote version", async () => {
    const mockDownloadExternalToolNow = vi.mocked(backend.downloadExternalToolNow);
    mockDownloadExternalToolNow.mockReset();

    const wrapper = mount(TestHost);
    const vm = wrapper.vm as unknown as {
      appSettings: AppSettings | null;
      toolStatuses: ExternalToolStatus[];
    };

    vm.appSettings = makeAppSettings();

    const inProgressStatus: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "download",
      version: "ffmpeg version 6.0",
      remoteVersion: "6.0",
      updateAvailable: true,
      autoDownloadEnabled: true,
      autoUpdateEnabled: true,
      downloadInProgress: true,
      downloadProgress: 50,
      downloadedBytes: 10 * 1024 * 1024,
      totalBytes: 20 * 1024 * 1024,
      bytesPerSecond: 2 * 1024 * 1024,
      lastDownloadError: undefined,
      lastDownloadMessage: "starting auto-download for ffmpeg",
    };

    // Snapshot where some other path (manual click / queue) has already
    // started a download. The auto-update watcher must not request another.
    vm.toolStatuses = [inProgressStatus];
    await nextTick();
    await flushPromises();

    expect(mockDownloadExternalToolNow).not.toHaveBeenCalled();

    // Even if the backend briefly reports updateAvailable=true again after
    // this download completes, the watcher should still treat this remote
    // version as "already attempted" in this session.
    const completedStatus: ExternalToolStatus = {
      ...inProgressStatus,
      downloadInProgress: false,
      downloadProgress: 100,
    };

    vm.toolStatuses = [completedStatus];
    await nextTick();
    await flushPromises();

    expect(mockDownloadExternalToolNow).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
