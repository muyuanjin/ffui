// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";

import type { ExternalToolStatus } from "@/types";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    loadAppSettings: vi.fn(async () => ({})),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    fetchExternalToolStatusesCached: vi.fn(async () => [] as ExternalToolStatus[]),
    refreshExternalToolStatusesAsync: vi.fn(async () => {
      // Simulate a backend that can emit a refreshed snapshot immediately.
      toolStatusHandler?.({
        payload: [
          {
            kind: "ffmpeg",
            resolvedPath: "C:/tools/ffmpeg.exe",
            source: "path",
            version: "ffmpeg version 6.0",
            remoteVersion: undefined,
            updateCheckResult: "unknown",
            updateAvailable: false,
            autoDownloadEnabled: false,
            autoUpdateEnabled: false,
            downloadInProgress: false,
            downloadProgress: undefined,
            downloadedBytes: undefined,
            totalBytes: undefined,
            bytesPerSecond: undefined,
            lastDownloadError: undefined,
            lastDownloadMessage: undefined,
          } satisfies ExternalToolStatus,
        ],
      });
      return true;
    }),
    fetchExternalToolCandidates: vi.fn(async () => []),
    downloadExternalToolNow: vi.fn(async () => []),
  };
});

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

import { i18n } from "@/i18n";
import { useMainAppSettings } from "@/composables/main-app/useMainAppSettings";
import * as backend from "@/lib/backend";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const TestHost = defineComponent({
  setup() {
    return useMainAppSettings({
      jobs: ref([]),
      manualJobPresetId: ref(null),
      smartConfig: ref({} as any),
      startupIdleReady: ref(true),
    });
  },
  template: "<div />",
});

describe("useMainAppSettings external tool warmup", () => {
  it("prewarms local tool probing once after startup idle", async () => {
    const refreshSpy = vi.mocked(backend.refreshExternalToolStatusesAsync);
    refreshSpy.mockClear();

    const wrapper = mount(TestHost, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(refreshSpy).toHaveBeenCalled();
    expect(refreshSpy).toHaveBeenCalledWith({ remoteCheck: false, manualRemoteCheck: false });

    const vm = wrapper.vm as any;
    expect(vm.toolStatusesFresh).toBe(true);
    expect(vm.toolStatuses?.[0]?.resolvedPath).toBe("C:/tools/ffmpeg.exe");

    wrapper.unmount();
  });
});
