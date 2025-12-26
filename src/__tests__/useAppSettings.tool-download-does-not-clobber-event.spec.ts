// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";

import type { AppSettings, ExternalToolStatus } from "@/types";

let toolStatusHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      if (event === "ffui://external-tool-status") {
        toolStatusHandler = handler;
      }
      return () => {};
    }),
  };
});

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadAppSettings: vi.fn(async () => ({}) as AppSettings),
    saveAppSettings: vi.fn(async (settings: AppSettings) => settings),
    fetchExternalToolStatusesCached: vi.fn(async () => {
      const status: ExternalToolStatus = {
        kind: "ffmpeg",
        resolvedPath: "C:/tools/ffmpeg.exe",
        source: "path",
        version: "ffmpeg version 6.0",
        remoteVersion: "6.1.1",
        updateCheckResult: "updateAvailable",
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
      return [status];
    }),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchExternalToolCandidates: vi.fn(async () => []),
    downloadExternalToolNow: vi.fn(),
  };
});

import { useAppSettings } from "@/composables/useAppSettings";
import * as backend from "@/lib/backend";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const TestHost = defineComponent({
  setup() {
    return useAppSettings();
  },
  template: "<div />",
});

describe("useAppSettings external tool downloads", () => {
  it("does not clobber event-driven download progress with the immediate command snapshot", async () => {
    const download = vi.mocked(backend.downloadExternalToolNow);

    let resolveDownload: ((value: ExternalToolStatus[]) => void) | undefined;
    download.mockImplementationOnce(
      () =>
        new Promise<ExternalToolStatus[]>((resolve) => {
          resolveDownload = (value) => resolve(value);
        }),
    );

    const wrapper = mount(TestHost);
    const vm = wrapper.vm as unknown as {
      toolStatuses: ExternalToolStatus[];
      downloadToolNow: (kind: "ffmpeg") => Promise<void>;
    };

    await flushPromises();
    expect(vm.toolStatuses[0]?.downloadInProgress).toBe(false);

    const downloadPromise = vm.downloadToolNow("ffmpeg");
    await nextTick();

    toolStatusHandler?.({
      payload: [
        {
          kind: "ffmpeg",
          resolvedPath: "C:/tools/ffmpeg.exe",
          source: "download",
          version: "ffmpeg version 6.1.1",
          remoteVersion: "6.1.1",
          updateCheckResult: "upToDate",
          updateAvailable: false,
          autoDownloadEnabled: true,
          autoUpdateEnabled: true,
          downloadInProgress: true,
          downloadProgress: 1,
          downloadedBytes: 1024,
          totalBytes: 2048,
          bytesPerSecond: 12345,
          lastDownloadError: undefined,
          lastDownloadMessage: "starting auto-download for ffmpeg",
        } satisfies ExternalToolStatus,
      ],
    });

    await nextTick();
    expect(vm.toolStatuses[0]?.downloadInProgress).toBe(true);

    // Simulate the command returning a stale, pre-download snapshot.
    resolveDownload?.([
      {
        kind: "ffmpeg",
        resolvedPath: "C:/tools/ffmpeg.exe",
        source: "path",
        version: "ffmpeg version 6.0",
        remoteVersion: "6.1.1",
        updateCheckResult: "updateAvailable",
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

    await downloadPromise;
    await flushPromises();
    await nextTick();

    expect(vm.toolStatuses[0]?.downloadInProgress).toBe(true);

    wrapper.unmount();
  });
});
