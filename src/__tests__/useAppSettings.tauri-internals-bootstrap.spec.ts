// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";

const invokeMock = vi.fn<(cmd: string, payload?: unknown) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => (payload === undefined ? invokeMock(cmd) : invokeMock(cmd, payload)),
  convertFileSrc: (path: string) => path,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import { useAppSettings } from "@/composables/useAppSettings";

const TestHost = defineComponent({
  setup() {
    return useAppSettings();
  },
  template: "<div />",
});

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useAppSettings bootstrap with Tauri v2 internals", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    delete (window as any).__TAURI_IPC__;
    delete (window as any).__TAURI__;
    (window as any).__TAURI_INTERNALS__ = {};

    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_app_settings") {
        return {
          tools: {
            ffmpegPath: undefined,
            ffprobePath: undefined,
            avifencPath: undefined,
            autoDownload: false,
            autoUpdate: false,
          },
          batchCompressDefaults: undefined,
          previewCapturePercent: 25,
          taskbarProgressMode: "byEstimatedTime",
        };
      }
      if (cmd === "get_external_tool_statuses_cached") {
        return [];
      }
      return null;
    });
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("loads cached external tool snapshot on mount", async () => {
    mount(TestHost);
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledWith("get_external_tool_statuses_cached");
  });
});
