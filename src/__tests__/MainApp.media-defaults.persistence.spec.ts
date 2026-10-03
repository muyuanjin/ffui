// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { AppSettings, FFmpegPreset, QueuePresetSelection } from "@/types";
import contract from "../../src-tauri/tests/settings-media-selection-contract.json";
import {
  buildAutoCompressResult,
  defaultAppSettings,
  dialogOpenMock,
  emitWindowCloseRequested,
  emitQueueState,
  i18n,
  invokeMock,
  useBackendMock,
} from "./helpers/mainAppTauriDialog";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import MainApp from "@/MainApp.vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";

const makeSettings = (): AppSettings => ({ ...defaultAppSettings(), ...structuredClone(contract) }) as AppSettings;
const presets = ["video", "audio", "image"].map<FFmpegPreset>((id) => ({
  id,
  name: id,
  description: "",
  video: { encoder: "libx264", rateControl: "crf", qualityValue: 23, preset: "medium" },
  audio: { codec: "copy" },
  filters: {},
  stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
}));

afterEach(() => vi.unstubAllGlobals());

describe("manual media defaults persistence", () => {
  it("waits for the edited output policy behind an in-flight save before enqueue", async () => {
    let disk = makeSettings();
    let finishSave!: () => void;
    let blockFirst = true;
    useBackendMock({
      get_app_settings: () => structuredClone(disk),
      get_presets: () => presets,
      save_app_settings: async ({ settings } = {}) => {
        if (blockFirst) {
          blockFirst = false;
          await new Promise<void>((resolve) => {
            finishSave = resolve;
          });
        }
        disk = structuredClone(settings as AppSettings);
        return disk;
      },
      enqueue_transcode_job: (payload) => {
        expect(disk.queueOutputPolicy?.container).toEqual({ mode: "force", format: "mkv" });
        return {
          id: "queued",
          filename: payload?.filename,
          type: "other",
          source: "manual",
          presetId: payload?.presetId,
          status: "queued",
          progress: 0,
          originalSizeMB: 0,
        };
      },
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    vm.setSelectionBarPinned(false);
    await flushPromises();
    wrapper.getComponent(MainContentHeader).vm.$emit("update:queueOutputPolicy", {
      ...contract.queueOutputPolicy,
      container: { mode: "force", format: "mkv" },
    });
    const enqueue = vm.enqueueManualJobsFromPaths(["D:/素材.mp4"]);
    await flushPromises();
    expect(invokeMock.mock.calls.some(([command]) => command === "enqueue_transcode_job")).toBe(false);
    finishSave();
    await enqueue;
    expect(invokeMock.mock.calls.some(([command]) => command === "enqueue_transcode_job")).toBe(true);
    expect(vm.queueError).toBeNull();
    wrapper.unmount();
  });
  it("keeps the last Batch Compress output defaults when a queue preference is saved afterwards", async () => {
    let disk = makeSettings();
    useBackendMock({
      get_app_settings: () => structuredClone(disk),
      get_presets: () => presets,
      save_app_settings: ({ settings } = {}) => {
        disk = structuredClone(settings as AppSettings);
        return disk;
      },
      run_auto_compress: ({ rootPath, config } = {}) => {
        disk.batchCompressDefaults = structuredClone(config as AppSettings["batchCompressDefaults"]);
        return buildAutoCompressResult(String(rootPath));
      },
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    const config = buildBatchCompressDefaults({
      rootPath: "D:/素材",
      videoPresetId: "video",
      audioPresetId: "audio",
      outputPolicy: contract.queueOutputPolicy as AppSettings["queueOutputPolicy"],
    });
    await vm.runBatchCompress(config);
    wrapper.getComponent(MainContentHeader).vm.$emit("update:queuePresetSelection", { mode: "unified" });
    await flushPromises();
    expect(disk.batchCompressDefaults).toEqual(config);
    wrapper.unmount();
  });
  it("flushes deferred preferences on close without bypassing active-task exit confirmation", async () => {
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    let disk = makeSettings();
    useBackendMock({
      get_app_settings: () => structuredClone(disk),
      get_presets: () => presets,
      save_app_settings: ({ settings } = {}) => {
        disk = structuredClone(settings as AppSettings);
        return disk;
      },
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    vm.appSettings.previewCapturePercent = 40;
    await nextTick();
    expect(disk.previewCapturePercent).toBe(25);
    emitQueueState([
      {
        id: "active",
        filename: "movie.mp4",
        type: "video",
        source: "manual",
        presetId: "video",
        status: "processing",
        progress: 1,
        originalSizeMB: 0,
      },
    ]);
    await nextTick();
    expect(await emitWindowCloseRequested()).toBe(true);
    expect(disk.previewCapturePercent).toBe(40);
    expect(invokeMock).toHaveBeenCalledWith("request_app_close", undefined);
    wrapper.unmount();
  });

  it("shows a settings failure and refuses to enqueue against an unsaved policy until retry succeeds", async () => {
    let disk = makeSettings();
    let fail = false;
    useBackendMock({
      get_app_settings: () => structuredClone(disk),
      get_presets: () => presets,
      save_app_settings: ({ settings } = {}) => {
        if (fail) throw new Error("settings access denied");
        disk = structuredClone(settings as AppSettings);
        return disk;
      },
      enqueue_transcode_job: (payload) => ({
        id: "queued",
        filename: payload?.filename,
        type: "other",
        source: "manual",
        presetId: payload?.presetId,
        status: "queued",
        progress: 0,
        originalSizeMB: 0,
      }),
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    fail = true;
    wrapper.getComponent(MainContentHeader).vm.$emit("update:queuePresetSelection", { mode: "unified" });
    await flushPromises();
    await vm.enqueueManualJobsFromPaths(["D:/素材.mp4"]);
    expect(wrapper.get('[data-testid="global-alerts"]').text()).toContain("settings access denied");
    expect(disk.queuePresetSelection).toEqual(contract.queuePresetSelection);
    expect(invokeMock.mock.calls.some(([command]) => command === "enqueue_transcode_job")).toBe(false);
    fail = false;
    await vm.enqueueManualJobsFromPaths(["D:/素材.mp4"]);
    expect(disk.queuePresetSelection).toEqual({ mode: "unified" });
    expect(vm.settingsSaveError).toBeNull();
    expect(invokeMock.mock.calls.some(([command]) => command === "enqueue_transcode_job")).toBe(true);
    wrapper.unmount();
    consoleError.mockRestore();
  });
  it.each(["unified", "byMedia"] as const)(
    "saves %s without an idle callback and restores it for file/folder/drop enqueue",
    async (mode) => {
      vi.stubGlobal(
        "requestIdleCallback",
        vi.fn(() => 1),
      );
      vi.stubGlobal("cancelIdleCallback", vi.fn());
      let disk = makeSettings();
      disk.queuePresetSelection = { mode: "unified" };
      disk.defaultQueuePresetId = "video";
      useBackendMock({
        get_app_settings: () => structuredClone(disk),
        get_presets: () => presets,
        save_app_settings: ({ settings } = {}) => {
          disk = structuredClone(settings as AppSettings);
          return disk;
        },
        enqueue_transcode_job: (payload) => ({
          id: String(payload?.filename),
          filename: payload?.filename,
          type: "other",
          source: "manual",
          presetId: payload?.presetId,
          status: "queued",
          progress: 0,
          originalSizeMB: 0,
        }),
        enqueue_transcode_jobs: (payload) =>
          (payload?.filenames as string[]).map((filename) => ({
            id: filename,
            filename,
            type: "other",
            source: "manual",
            presetId: payload?.presetId,
            status: "queued",
            progress: 0,
            originalSizeMB: 0,
          })),
      });
      const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
      await flushPromises();
      const header = wrapper.getComponent(MainContentHeader);
      const selection: QueuePresetSelection =
        mode === "byMedia" ? (contract.queuePresetSelection as QueuePresetSelection) : { mode };
      header.vm.$emit("update:queuePresetSelection", selection);
      header.vm.$emit("update:manualJobPresetId", "audio");
      await flushPromises();
      expect(disk.queuePresetSelection).toEqual(selection);
      expect(disk.defaultQueuePresetId).toBe("audio");
      expect(disk.queueOutputPolicy).toEqual(contract.queueOutputPolicy);
      wrapper.unmount();

      const restarted = mount(MainApp, { global: { plugins: [i18n] } });
      await flushPromises();
      const restored = restarted.getComponent(MainContentHeader).props();
      expect(restored.queuePresetSelection).toEqual(selection);
      expect(restored.manualJobPresetId).toBe("audio");
      expect(restored.queueOutputPolicy).toEqual(contract.queueOutputPolicy);
      const vm = withMainAppVmCompat(restarted);
      const files = ["D:/素材.mp4", "D:/素材.flac", "D:/素材.png"];
      dialogOpenMock.mockResolvedValueOnce(files);
      await vm.addManualJob("files");
      dialogOpenMock.mockResolvedValueOnce(files);
      await vm.addManualJob("folder");
      await vm.enqueueManualJobsFromPaths(files);
      const requests = invokeMock.mock.calls.filter(
        ([command]) => command === "enqueue_transcode_job" || command === "enqueue_transcode_jobs",
      );
      if (mode === "byMedia") {
        expect(requests.map(([, payload]) => payload?.presetId)).toEqual([
          "video",
          "audio",
          "image",
          "video",
          "audio",
          "image",
          "video",
          "audio",
          "image",
        ]);
      } else {
        expect(requests).toHaveLength(3);
        expect(requests.every(([, payload]) => payload?.presetId === "audio")).toBe(true);
      }
      restarted.unmount();
    },
  );

  it("keeps early preset/output/pin edits and loaded unrelated fields with one settings load", async () => {
    let resolveSettings!: (value: AppSettings) => void;
    const loading = new Promise<AppSettings>((resolve) => {
      resolveSettings = resolve;
    });
    let saved: AppSettings | undefined;
    useBackendMock({
      get_app_settings: () => loading,
      get_presets: () => presets,
      save_app_settings: ({ settings } = {}) => {
        saved = structuredClone(settings as AppSettings);
        return saved;
      },
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm = withMainAppVmCompat(wrapper);
    const header = wrapper.getComponent(MainContentHeader);
    header.vm.$emit("update:queuePresetSelection", contract.queuePresetSelection);
    header.vm.$emit("update:manualJobPresetId", "image");
    header.vm.$emit("update:queueOutputPolicy", contract.queueOutputPolicy);
    vm.setSelectionBarPinned(true);
    vm.setPresetSelectionBarPinned(true);
    vm.presetSortMode = "name";
    vm.presetViewMode = "compact";
    await nextTick();
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_app_settings")).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "save_app_settings")).toBe(false);
    const loaded = makeSettings();
    loaded.defaultQueuePresetId = "audio";
    loaded.queuePresetSelection = { mode: "unified" };
    loaded.queueOutputPolicy = undefined;
    loaded.tools.ffmpegPath = "C:/工具/ffmpeg.exe";
    loaded.locale = "zh-CN";
    resolveSettings(loaded);
    await flushPromises();
    await flushPromises();
    expect(saved).toMatchObject({
      ...contract,
      defaultQueuePresetId: "image",
      tools: { ffmpegPath: "C:/工具/ffmpeg.exe" },
      locale: "zh-CN",
    });
    expect(header.props("manualJobPresetId")).toBe("image");
    wrapper.unmount();
  });

  it.each(["settings-first", "presets-first"])("restores custom IDs when startup is %s", async (order) => {
    let finishSettings!: (settings: AppSettings) => void;
    let finishPresets!: (value: FFmpegPreset[]) => void;
    useBackendMock({
      get_app_settings: () =>
        new Promise<AppSettings>((resolve) => {
          finishSettings = resolve;
        }),
      get_presets: () =>
        new Promise<FFmpegPreset[]>((resolve) => {
          finishPresets = resolve;
        }),
      save_app_settings: ({ settings } = {}) => settings,
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    if (order === "settings-first") {
      finishSettings(makeSettings());
      await flushPromises();
      finishPresets(presets);
    } else {
      finishPresets(presets);
      await flushPromises();
      finishSettings(makeSettings());
    }
    await flushPromises();
    const header = wrapper.getComponent(MainContentHeader);
    expect(header.props("manualJobPresetId")).toBe("audio");
    expect(header.props("queuePresetSelection")).toEqual(contract.queuePresetSelection);
    expect(
      invokeMock.mock.calls
        .filter(([command]) => command === "save_app_settings")
        .every(([, payload]) => (payload?.settings as AppSettings).defaultQueuePresetId === "audio"),
    ).toBe(true);
    wrapper.unmount();
  });
});
