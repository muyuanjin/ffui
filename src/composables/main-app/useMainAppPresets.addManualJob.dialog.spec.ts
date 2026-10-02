// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import type { FFmpegPreset, QueuePresetSelection } from "@/types";

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
function mountPresets(selection: QueuePresetSelection = { mode: "unified" }): AddManualJobApi {
  let api: AddManualJobApi | null = null;
  mount(
    defineComponent({
      setup() {
        const presets = ref<FFmpegPreset[]>([
          makePreset(),
          { ...makePreset(), id: "audio" },
          { ...makePreset(), id: "image" },
        ]);
        const presetsLoadedFromBackend = ref(true);
        const manualJobPresetId = ref<string | null>(null);
        const locale = ref("en");
        api = useMainAppPresets({
          t: (key: string) => key,
          locale,
          presets,
          presetsLoadedFromBackend,
          manualJobPresetId,
          queuePresetSelection: ref(selection),
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
  it("routes expanded folder files through the per-input presets", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/mixed"]);
    expandManualJobInputsMock.mockResolvedValueOnce({
      accepted: ["C:/mixed/movie.mp4", "C:/mixed/track.wav", "C:/mixed/cover.jpg"],
      skipped: 0,
    });
    const api = mountPresets({ mode: "byMedia", video: "audio", image: "image" });
    await api.addManualJob("folder");
    expect(enqueueTranscodeJobMock.mock.calls.map(([request]) => [request.filename, request.presetId])).toEqual([
      ["C:/mixed/movie.mp4", "audio"],
      ["C:/mixed/track.wav", "preset-1"],
      ["C:/mixed/cover.jpg", "image"],
    ]);
  });
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

  it("enqueues audio and image files without claiming they are video", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/videos/a.mp4", "C:/music/b.mp3"]);
    const filenames = ["C:/music/b.mp3", "C:/pictures/图像.png"];
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: filenames, skipped: 0 });
    enqueueTranscodeJobMock.mockResolvedValueOnce({ id: "job-1" });

    const api = mountPresets();
    await api.addManualJob("files");
    await flushPromises();

    expect(enqueueTranscodeJobsMock).toHaveBeenCalledWith(expect.objectContaining({ filenames, jobType: "other" }));
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("reports a folder containing only inaccessible entries", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/Music/Album"]);
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: [], skipped: 5 });

    const api = mountPresets();
    await api.addManualJob("folder");
    await flushPromises();

    expect(enqueueTranscodeJobMock).not.toHaveBeenCalled();
    expect(enqueueTranscodeJobsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("queue.error.unsupportedMedia", { duration: 6000 });
  });

  it("shows backend enqueue diagnostics instead of silently failing", async () => {
    openDialogMock.mockResolvedValueOnce(["C:/music/b.mp3"]);
    expandManualJobInputsMock.mockResolvedValueOnce({ accepted: ["C:/music/b.mp3"], skipped: 0 });
    enqueueTranscodeJobMock.mockRejectedValueOnce(new Error("Invalid audio preset"));
    const api = mountPresets();
    await api.addManualJob("files");
    expect(toastErrorMock).toHaveBeenCalledWith("queue.error.enqueueFailed", {
      description: "Invalid audio preset",
      duration: 6000,
    });
  });
});
