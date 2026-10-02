// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import mediaContract from "../../src-tauri/tests/manual-preset-media-contract.json";
import { usePresetEditor } from "@/composables/usePresetEditor";
import { useMainAppPresets } from "@/composables/main-app/useMainAppPresets";
import { useMainAppDnDAndContextMenu } from "@/composables/main-app/useMainAppDnDAndContextMenu";
import { enqueueManualJobsFromPaths } from "@/composables/queue/operations-single";
import { enqueueTranscodeJob } from "@/lib/backend";
import { previewOutputPathLocal } from "@/lib/outputPolicyPreview";
import { DEFAULT_OUTPUT_POLICY } from "@/types/output-policy";

const boundary = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), toastError: vi.fn(), subscribe: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: boundary.open }));
vi.mock("vue-sonner", () => ({ toast: { error: boundary.toastError } }));
vi.mock("@/lib/tauriSubscriptions", () => ({ subscribeTauriEventInCurrentScope: boundary.subscribe }));

describe("preset-driven manual media workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it.each(mediaContract.cases)(
    "saves and selects $id for files, folders and drag/drop through canonical IPC",
    async (entry) => {
      const initial = structuredClone(entry.preset) as FFmpegPreset;
      expect(previewOutputPathLocal(`C:/素材/${entry.inputName}`, DEFAULT_OUTPUT_POLICY, { preset: initial })).toMatch(
        new RegExp(`\\.${entry.outputExtension}$`),
      );
      const fallback = { ...initial, id: "not-selected" };
      const presets = ref<FFmpegPreset[]>([fallback]);
      const selected = ref<string | null>(fallback.id);
      const filename = `C:\\素材 文件\\${entry.inputName}`;
      const folder = "C:\\素材 文件\\专辑";
      const second = `C:\\素材 文件\\second-${entry.inputName}`;
      const outputPath = `C:\\素材 文件\\转换结果.${entry.outputExtension}`;
      const wireJob = (path: string) => ({
        id: path,
        filename: path,
        type: "other",
        source: "manual",
        presetId: initial.id,
        status: "queued",
        progress: 0,
        originalSizeMB: 0,
        inputPath: path,
        outputPath: entry.knownOutput ? outputPath : undefined,
        execution: {
          kind: "ffmpeg",
          invocation: {
            args: ["-i", path, outputPath],
            workingDirectory: null,
            output:
              entry.executionMode === "managedFile"
                ? { kind: "managedFile", path: outputPath, argumentIndex: 2 }
                : { kind: "transparent" },
          },
        },
      });
      boundary.invoke.mockImplementation(async (command: string, payload: any) => {
        if (command === "save_preset") return [fallback, payload.preset];
        if (command === "expand_manual_job_inputs")
          return { accepted: payload.paths[0] === folder ? [filename, second] : payload.paths, skipped: 0 };
        if (command === "enqueue_transcode_job") return wireJob(payload.filename);
        if (command === "enqueue_transcode_jobs") return payload.filenames.map(wireJob);
        throw new Error(`Unexpected IPC ${command}`);
      });
      let api!: ReturnType<typeof useMainAppPresets>;
      let drag!: ReturnType<typeof useMainAppDnDAndContextMenu>;
      const queueError = ref<string | null>(null);
      const refresh = vi.fn(async () => {});
      const wrapper = mount(
        defineComponent({
          setup() {
            api = useMainAppPresets({
              t: (key) => key,
              locale: ref("en"),
              presets,
              presetsLoadedFromBackend: ref(true),
              manualJobPresetId: selected,
              dialogManager: { closeWizard: vi.fn(), closeParameterPanel: vi.fn() } as any,
            });
            drag = useMainAppDnDAndContextMenu({
              activeTab: ref("queue"),
              inspectMediaForPath: vi.fn(),
              selectedJobIds: ref(new Set<string>()),
              bulkMoveSelectedJobsToTopInner: vi.fn(),
              enqueueManualJobsFromPaths: (paths) =>
                enqueueManualJobsFromPaths(paths, {
                  jobs: ref<TranscodeJob[]>([]),
                  presets,
                  manualJobPreset: api.manualJobPreset,
                  queueError,
                  refreshQueueFromBackend: refresh,
                  t: (key) => key,
                }),
            });
            return {};
          },
          template: "<div />",
        }),
      );
      const editor = usePresetEditor({ initialPreset: initial });
      await api.handleSavePreset(editor.buildPresetFromState());
      expect(boundary.toastError).not.toHaveBeenCalled();
      expect(boundary.invoke).toHaveBeenCalledWith("save_preset", {
        preset: expect.objectContaining({
          id: initial.id,
          audio: initial.audio,
          container: initial.container ?? {},
          advancedEnabled: initial.advancedEnabled,
          ffmpegTemplate: initial.ffmpegTemplate,
        }),
      });
      selected.value = initial.id;
      expect(api.manualJobPreset.value?.id).toBe(initial.id);
      boundary.open.mockResolvedValueOnce([filename]);
      await api.addManualJob("files");
      expect(boundary.open).toHaveBeenLastCalledWith({ multiple: true, directory: false, recursive: false });
      expect(boundary.invoke).toHaveBeenCalledWith("enqueue_transcode_job", {
        filename,
        jobType: "other",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: initial.id,
      });
      boundary.open.mockResolvedValueOnce([folder]);
      await api.addManualJob("folder");
      expect(boundary.open).toHaveBeenLastCalledWith({ multiple: true, directory: true, recursive: true });
      expect(boundary.invoke).toHaveBeenCalledWith("enqueue_transcode_jobs", {
        filenames: [filename, second],
        jobType: "other",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: initial.id,
      });
      await drag.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { types: ["Files"], files: [{ path: filename, name: entry.inputName }] },
      } as unknown as DragEvent);
      expect(boundary.invoke).toHaveBeenLastCalledWith("enqueue_transcode_job", {
        filename,
        jobType: "other",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: initial.id,
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      const desktopDrop = boundary.subscribe.mock.calls.find(([event]) => event === "tauri://drag-drop")?.[1];
      expect(desktopDrop).toBeTypeOf("function");
      desktopDrop({ paths: [folder] });
      await flushPromises();
      expect(boundary.invoke).toHaveBeenLastCalledWith("enqueue_transcode_jobs", {
        filenames: [filename, second],
        jobType: "other",
        source: "manual",
        originalSizeMb: 0,
        originalCodec: undefined,
        presetId: initial.id,
      });
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(queueError.value).toBeNull();
      expect(boundary.invoke.mock.calls.some(([command]) => command === "enqueue_ffmpeg_job")).toBe(false);
      const returned = await enqueueTranscodeJob({
        filename,
        jobType: "other",
        source: "manual",
        originalSizeMb: 0,
        presetId: initial.id,
      });
      expect(returned.outputPath).toBe(outputPath);
      expect(returned.inputPath).toBe(filename);
      expect(returned.outputPath).not.toBe(returned.inputPath);
      expect(returned.executionMode).toBe(entry.executionMode === "managedFile" ? "managed" : "transparent");
      wrapper.unmount();
    },
  );
});
