// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import MainApp from "@/MainApp.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => '{"format":{"duration":"60"},"streams":[]}'),
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(
      async (candidates: string[]) => candidates[0] ?? null,
    ),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("MainApp media inspect in non-Tauri (web) mode", () => {
  it("handles DOM drop on media tab and records basic inspected media state", async () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.activeTab = "media";

    const file = new File(["dummy"], "sample.mp4", { type: "video/mp4" });
    (file as any).path = "C:/videos/sample.mp4";

    const event = {
      preventDefault: () => {},
      dataTransfer: {
        files: [file],
        length: 1,
      },
    } as unknown as DragEvent;

    vm.handleDrop(event);

    // inspectMediaForPath is async; wait for the microtask queue to flush.
    await Promise.resolve();

    expect(vm.inspectedMediaPath).toBe("C:/videos/sample.mp4");
    expect(vm.inspectedAnalysis && vm.inspectedAnalysis.summary).not.toBeNull();

    // 清空后应回到“未选择媒体”的空态。
    vm.clearInspectedMedia();
    expect(vm.inspectedMediaPath).toBeNull();
    expect(vm.inspectedAnalysis).toBeNull();
  });
});
