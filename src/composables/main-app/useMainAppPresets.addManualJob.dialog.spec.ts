// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import type { FFmpegPreset } from "@/types";

const openDialogMock = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: any[]) => openDialogMock(...args),
}));

const expandManualJobInputsMock = vi.fn();
const enqueueTranscodeJobMock = vi.fn();
const enqueueTranscodeJobsMock = vi.fn();

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    expandManualJobInputs: (...args: any[]) => expandManualJobInputsMock(...args),
    enqueueTranscodeJob: (...args: any[]) => enqueueTranscodeJobMock(...args),
    enqueueTranscodeJobs: (...args: any[]) => enqueueTranscodeJobsMock(...args),
  };
});

import { useMainAppPresets } from "./useMainAppPresets";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const makePreset = (): FFmpegPreset => ({
  id: "preset-1",
  name: "Default",
  description: "test preset",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: {
    usageCount: 0,
    totalInputSizeMB: 0,
    totalOutputSizeMB: 0,
    totalTimeSeconds: 0,
  },
});

describe("useMainAppPresets addManualJob dialog (Tauri v2 internals)", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    expandManualJobInputsMock.mockReset();
    enqueueTranscodeJobMock.mockReset();
    enqueueTranscodeJobsMock.mockReset();

    delete (window as any).__TAURI_IPC__;
    delete (window as any).__TAURI__;
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("opens file dialog and enqueues job when only __TAURI_INTERNALS__ exists", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/videos/a.mp4"]);
    expandManualJobInputsMock.mockResolvedValueOnce(["C:/videos/a.mp4"]);
    enqueueTranscodeJobMock.mockResolvedValueOnce({ id: "job-1" });

    let api: { addManualJob: (mode?: "files" | "folder") => Promise<void> } | null = null;

    mount(
      defineComponent({
        setup() {
          const presets = ref<FFmpegPreset[]>([makePreset()]);
          const presetsLoadedFromBackend = ref(true);
          const manualJobPresetId = ref<string | null>(null);
          const locale = ref("en");
          api = useMainAppPresets({
            t: (key: string) => key,
            locale,
            presets,
            presetsLoadedFromBackend,
            manualJobPresetId,
            dialogManager: {
              openParameterPanel: () => {},
              closeParameterPanel: () => {},
              closeWizard: () => {},
            } as any,
            shell: undefined,
          });
          return {};
        },
        template: "<div />",
      }),
    );

    await api!.addManualJob("files");
    await flushPromises();

    expect(openDialogMock).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      recursive: false,
    });
    expect(expandManualJobInputsMock).toHaveBeenCalledWith(["C:/videos/a.mp4"], { recursive: true });
    expect(enqueueTranscodeJobMock).toHaveBeenCalled();
    expect(enqueueTranscodeJobsMock).not.toHaveBeenCalled();
  });
});
