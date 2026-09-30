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
const toastErrorMock = vi.fn();

vi.mock("vue-sonner", () => {
  const toast: any = vi.fn();
  toast.success = vi.fn();
  toast.error = (...args: any[]) => toastErrorMock(...args);
  toast.info = vi.fn();
  toast.warning = vi.fn();
  toast.dismiss = vi.fn();
  return { toast };
});

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
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
});

type AddManualJobApi = { addManualJob: (mode?: "files" | "folder") => Promise<void> };

/** 挂载 useMainAppPresets 并取回 addManualJob（Tauri v2 只看 __TAURI_INTERNALS__）。 */
function mountPresets(): AddManualJobApi {
  let api: AddManualJobApi | null = null;
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
        }) as unknown as AddManualJobApi;
        return {};
      },
      template: "<div />",
    }),
  );
  if (!api) throw new Error("addManualJob was not created");
  return api;
}

describe("useMainAppPresets addManualJob dialog (Tauri v2 internals)", () => {
  beforeEach(() => {
    openDialogMock.mockReset();
    expandManualJobInputsMock.mockReset();
    enqueueTranscodeJobMock.mockReset();
    enqueueTranscodeJobsMock.mockReset();
    toastErrorMock.mockReset();

    delete (window as any).__TAURI_IPC__;
    delete (window as any).__TAURI__;
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("opens file dialog and enqueues job when only __TAURI_INTERNALS__ exists", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/videos/a.mp4"]);
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: ["C:/videos/a.mp4"], skipped: 0 });
    enqueueTranscodeJobMock.mockResolvedValueOnce({ id: "job-1" });

    const api = mountPresets();
    await api.addManualJob("files");
    await flushPromises();

    expect(openDialogMock).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      recursive: false,
    });
    expect(expandManualJobInputsMock).toHaveBeenCalledWith(["C:/videos/a.mp4"], { recursive: true });
    expect(enqueueTranscodeJobMock).toHaveBeenCalled();
    expect(enqueueTranscodeJobsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("enqueues the video files of a mixed selection and explains the skipped ones", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/videos/a.mp4", "C:/music/b.mp3"]);
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: ["C:/videos/a.mp4"], skipped: 1 });
    enqueueTranscodeJobMock.mockResolvedValueOnce({ id: "job-1" });

    const api = mountPresets();
    await api.addManualJob("files");
    await flushPromises();

    expect(enqueueTranscodeJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "C:/videos/a.mp4", jobType: "video" }),
    );
    expect(toastErrorMock).toHaveBeenCalledWith("queue.error.unsupportedMedia", { duration: 6000 });
  });

  it("explains a folder that contains no video (this used to be silence)", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/Music/Album"]);
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: [], skipped: 5 });

    const api = mountPresets();
    await api.addManualJob("folder");
    await flushPromises();

    expect(enqueueTranscodeJobMock).not.toHaveBeenCalled();
    expect(enqueueTranscodeJobsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("queue.error.unsupportedMedia", { duration: 6000 });
  });
});
