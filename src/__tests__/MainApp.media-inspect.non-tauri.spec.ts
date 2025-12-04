import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import MainApp from "@/MainApp.vue";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null) => path,
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({} as any)),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchGpuUsage: vi.fn(async () => ({} as any)),
    loadAppSettings: vi.fn(async () => ({} as any)),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({} as any)),
    cancelTranscodeJob: vi.fn(async () => true),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

describe("MainApp media inspect in non-Tauri (web) mode", () => {
  it("handles DOM drop on media tab without calling inspectMedia and records basic info", () => {
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

    const source = vm.mediaInspectSource;
    expect(source && source.name).toBe("sample.mp4");
    expect(source && source.path).toBe("C:/videos/sample.mp4");

    // 清空后应回到“未选择媒体”的空态。
    vm.clearMediaInspection();
    expect(vm.mediaInspectSource).toBeNull();
  });
});
