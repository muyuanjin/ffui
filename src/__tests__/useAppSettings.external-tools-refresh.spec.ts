// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";

import type { ExternalToolStatus } from "@/types";

let toolStatusHandler: ((event: { payload: unknown }) => void) | null = null;

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadAppSettings: vi.fn(async () => ({})),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    fetchExternalToolStatuses: vi.fn(async () => {
      throw new Error("blocking tool probe must not be called in startup tests");
    }),
    fetchExternalToolStatusesCached: vi.fn(async () => [] as ExternalToolStatus[]),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchExternalToolCandidates: vi.fn(async () => []),
    downloadExternalToolNow: vi.fn(async () => []),
  };
});

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

import { useAppSettings } from "@/composables/useAppSettings";
import * as backend from "@/lib/backend";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const TestHost = defineComponent({
  setup() {
    return useAppSettings();
  },
  template: "<div />",
});

describe("useAppSettings external tool async refresh", () => {
  it("loads cached snapshot on startup and updates state from events", async () => {
    const cachedSpy = vi.mocked(backend.fetchExternalToolStatusesCached);
    cachedSpy.mockResolvedValueOnce([]);

    const wrapper = mount(TestHost);
    const vm = wrapper.vm as unknown as {
      toolStatuses: ExternalToolStatus[];
      toolStatusesFresh: boolean;
    };

    await flushPromises();

    expect(cachedSpy).toHaveBeenCalled();
    expect(vm.toolStatuses).toEqual([]);
    expect(vm.toolStatusesFresh).toBe(false);

    const payload: ExternalToolStatus[] = [
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
    ];

    toolStatusHandler?.({ payload });
    await flushPromises();

    expect(vm.toolStatuses[0]?.remoteVersion).toBe("6.1.1");
    expect(vm.toolStatusesFresh).toBe(true);

    wrapper.unmount();
  });

  it("does not call the blocking get_external_tool_statuses on startup", async () => {
    const blockingSpy = vi.mocked(backend.fetchExternalToolStatuses);
    blockingSpy.mockClear();

    const wrapper = mount(TestHost);
    await flushPromises();

    expect(blockingSpy).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});
