// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import type { AppSettings, FFmpegPreset } from "@/types";
import { defaultAppSettings, i18n, invokeMock, useBackendMock } from "./helpers/mainAppTauriDialog";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import MainApp from "@/MainApp.vue";
import MainContentHeader from "@/components/main/MainContentHeader.vue";
import OutputPolicyEditor from "@/components/output/OutputPolicyEditor.vue";
import contract from "../../src-tauri/tests/settings-media-selection-contract.json";

const settings = (): AppSettings =>
  ({
    ...defaultAppSettings(),
    ...structuredClone(contract),
    defaultQueuePresetId: "custom-audio",
    queuePresetSelection: { mode: "unified" },
  }) as AppSettings;
const presets: FFmpegPreset[] = [
  {
    id: "custom-audio",
    name: "custom audio",
    description: "",
    video: { encoder: "copy", rateControl: "crf", qualityValue: 23, preset: "medium" },
    audio: { codec: "copy" },
    filters: {},
    stats: { usageCount: 0, totalInputSizeMB: 0, totalOutputSizeMB: 0, totalTimeSeconds: 0 },
  },
];
const job = (payload?: Record<string, unknown>) => ({
  id: "queued",
  filename: payload?.filename,
  type: "other",
  source: "manual",
  presetId: payload?.presetId,
  status: "queued",
  progress: 0,
  originalSizeMB: 0,
});
const enqueued = () => invokeMock.mock.calls.filter(([command]) => command === "enqueue_transcode_job");

afterEach(() => vi.unstubAllGlobals());

describe("settings hydration at editing and enqueue boundaries", () => {
  it.each(["missing", "classified"])(
    "keeps a missing unified ID without silently substituting when %s",
    async (mode) => {
      const stored = settings();
      stored.defaultQueuePresetId = "deleted-preset";
      if (mode === "classified") stored.queuePresetSelection = { mode: "byMedia", audio: "custom-audio" };
      useBackendMock({
        get_app_settings: () => stored,
        get_presets: () => presets,
        save_app_settings: ({ settings } = {}) => settings,
        enqueue_transcode_job: job,
      });
      const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
      await flushPromises();
      const vm = withMainAppVmCompat(wrapper);
      await vm.enqueueManualJobsFromPaths(["D:/music.wav"]);
      if (mode === "classified") expect(enqueued()[0][1]?.presetId).toBe("custom-audio");
      else {
        expect(enqueued()).toHaveLength(0);
        expect(vm.queueError).toContain("deleted-preset");
      }
      expect(wrapper.getComponent(MainContentHeader).props("manualJobPresetId")).toBe("deleted-preset");
      wrapper.unmount();
    },
  );
  it("does not allow placeholder output editing before loading the saved policy", async () => {
    let finish!: (value: AppSettings) => void;
    useBackendMock({
      get_app_settings: () =>
        new Promise<AppSettings>((resolve) => {
          finish = resolve;
        }),
      get_presets: () => presets,
      save_app_settings: ({ settings } = {}) => settings,
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const header = wrapper.getComponent(MainContentHeader);
    expect(header.get('[data-testid="ffui-queue-output-settings"]').attributes("disabled")).toBeDefined();
    await header.get('[data-testid="ffui-queue-output-settings"]').trigger("click");
    expect(header.findComponent(OutputPolicyEditor).exists()).toBe(false);
    const saved = settings();
    finish(saved);
    await flushPromises();
    expect(header.get('[data-testid="ffui-queue-output-settings"]').attributes("disabled")).toBeUndefined();
    expect(header.props("queueOutputPolicy")).toEqual(saved.queueOutputPolicy);
    const writes = invokeMock.mock.calls.filter(([command]) => command === "save_app_settings");
    expect(
      writes.every(([, payload]) => (payload?.settings as AppSettings).queueOutputPolicy?.directory.mode === "fixed"),
    ).toBe(true);
    wrapper.unmount();
  });

  it("waits for the backend preset list before enqueuing the restored custom ID", async () => {
    let finish!: (value: FFmpegPreset[]) => void;
    useBackendMock({
      get_app_settings: settings,
      get_presets: () =>
        new Promise<FFmpegPreset[]>((resolve) => {
          finish = resolve;
        }),
      save_app_settings: ({ settings } = {}) => settings,
      enqueue_transcode_job: job,
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    const adding = vm.enqueueManualJobsFromPaths(["D:/music.wav"]);
    await flushPromises();
    expect(enqueued()).toHaveLength(0);
    finish(presets);
    await adding;
    expect(enqueued()[0][1]?.presetId).toBe("custom-audio");
    wrapper.unmount();
  });

  it("reports failed preset loading instead of executing a temporary built-in preset", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useBackendMock({
      get_app_settings: settings,
      get_presets: () => Promise.reject(new Error("preset read denied")),
      save_app_settings: ({ settings } = {}) => settings,
      enqueue_transcode_job: job,
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    await vm.enqueueManualJobsFromPaths(["D:/music.wav"]);
    expect(enqueued()).toHaveLength(0);
    expect(vm.queueError).toContain("preset read denied");
    wrapper.unmount();
    consoleError.mockRestore();
  });

  it("flushes edits made during directory expansion before snapshotting the job", async () => {
    let disk = settings();
    let finishExpansion!: () => void;
    let finishSave!: () => void;
    let blockSave = false;
    useBackendMock({
      get_app_settings: () => disk,
      get_presets: () => presets,
      expand_manual_job_inputs: async () => {
        await new Promise<void>((resolve) => {
          finishExpansion = resolve;
        });
        return { accepted: ["D:/music.wav"], skipped: 0 };
      },
      save_app_settings: async ({ settings } = {}) => {
        if (blockSave) {
          blockSave = false;
          await new Promise<void>((resolve) => {
            finishSave = resolve;
          });
        }
        disk = structuredClone(settings as AppSettings);
        return disk;
      },
      enqueue_transcode_job: (payload) => {
        expect(disk.queueOutputPolicy?.directory).toEqual({ mode: "fixed", directory: "D:/new-output" });
        return job(payload);
      },
    });
    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    await flushPromises();
    const vm = withMainAppVmCompat(wrapper);
    const adding = vm.enqueueManualJobsFromPaths(["D:/folder"]);
    await flushPromises();
    blockSave = true;
    vm.setSelectionBarPinned(false);
    await flushPromises();
    wrapper.getComponent(MainContentHeader).vm.$emit("update:queueOutputPolicy", {
      ...contract.queueOutputPolicy,
      directory: { mode: "fixed", directory: "D:/new-output" },
    });
    finishExpansion();
    await flushPromises();
    expect(enqueued()).toHaveLength(0);
    finishSave();
    await adding;
    expect(enqueued()).toHaveLength(1);
    wrapper.unmount();
  });
});
