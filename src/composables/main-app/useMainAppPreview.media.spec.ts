// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FFmpegPreset, TranscodeJob } from "@/types";
import useMainAppDialogs from "./useMainAppDialogs";
import useMainAppPreview from "./useMainAppPreview";

const backend = vi.hoisted(() => ({ probe: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  hasTauri: () => true,
  buildPreviewUrl: (path: string) => `asset:${path}`,
  probeMediaPreviewInfo: backend.probe,
  selectPlayableMediaPath: backend.select,
}));
const Harness = defineComponent({
  setup() {
    const { dialogManager } = useMainAppDialogs();
    return {
      dialogManager,
      ...useMainAppPreview({ presets: ref<FFmpegPreset[]>([]), dialogManager, t: (key) => key }),
    };
  },
  template: "<div />",
});
const job = (id = "job"): TranscodeJob => ({
  id,
  filename: "in.mp4",
  inputPath: "in.mp4",
  outputPath: "out.mkv",
  type: "video",
  source: "manual",
  originalSizeMB: 1,
  originalCodec: "h264",
  presetId: "preset",
  status: "completed",
  progress: 100,
  logs: [],
});

describe("queue preview selected media", () => {
  beforeEach(() => {
    backend.probe.mockReset().mockResolvedValue({ kind: "audio", durationSeconds: 2 });
    backend.select.mockReset().mockImplementation(async (paths: string[]) => paths[0]);
  });
  it("uses actual audio-only MKV output instead of video input task type", async () => {
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    expect(backend.probe).toHaveBeenCalledWith("out.mkv");
    expect(wrapper.vm.previewMediaKind).toBe("audio");
    expect(wrapper.vm.previewDurationSeconds).toBe(2);
    await wrapper.vm.handleExpandedPreviewError();
    expect(wrapper.vm.previewPath).toBe("out.mkv");
    expect(wrapper.vm.previewError).toBeNull();
    backend.probe.mockResolvedValueOnce({ kind: "video", durationSeconds: 10 });
    await wrapper.vm.setPreviewSourceMode("input");
    expect(wrapper.vm.previewMediaKind).toBe("video");
    expect(wrapper.vm.previewPath).toBe("in.mp4");
    expect(wrapper.vm.previewDurationSeconds).toBe(10);
    wrapper.unmount();
  });
  it("displays extracted images even when the job input was video", async () => {
    backend.probe.mockResolvedValue({ kind: "image", durationSeconds: null });
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    expect(wrapper.vm.previewIsImage).toBe(true);
    expect(wrapper.vm.previewDurationSeconds).toBeNull();
    wrapper.unmount();
  });
  it("reports probe failure instead of silently choosing a video or another source", async () => {
    backend.probe.mockRejectedValue(new Error("missing input or invalid media"));
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    expect(wrapper.vm.previewUrl).toBeNull();
    expect(wrapper.vm.previewMediaKind).toBeNull();
    expect(wrapper.vm.previewError).toContain("missing input or invalid media");
    expect(backend.select).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("retains the probed video output for frame fallback when the automatic input retry cannot be probed", async () => {
    backend.probe.mockResolvedValueOnce({ kind: "video", durationSeconds: 10 });
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    backend.probe.mockRejectedValueOnce(new Error("invalid input media"));
    await wrapper.vm.handleExpandedPreviewError();
    expect(wrapper.vm.previewPath).toBe("out.mkv");
    expect(wrapper.vm.previewUrl).toBe("asset:out.mkv");
    expect(wrapper.vm.previewMediaKind).toBe("video");
    expect(wrapper.vm.previewDurationSeconds).toBe(10);
    expect(wrapper.vm.previewSourceMode).toBe("output");
    expect(wrapper.vm.previewError).toBe("jobDetail.previewVideoError");
    expect(backend.probe.mock.calls.map(([path]) => path)).toEqual(["out.mkv", "in.mp4"]);
    wrapper.unmount();
  });
  it("enters output frame fallback when the recorded input is missing and only the failed output exists", async () => {
    backend.probe.mockResolvedValue({ kind: "video", durationSeconds: 10 });
    backend.select.mockImplementation(async (paths: string[]) => paths.find((path) => path === "out.mkv") ?? null);
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    await wrapper.vm.handleExpandedPreviewError();
    expect(backend.select).toHaveBeenLastCalledWith(["in.mp4"]);
    expect(backend.probe).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.previewPath).toBe("out.mkv");
    expect(wrapper.vm.previewUrl).toBe("asset:out.mkv");
    expect(wrapper.vm.previewMediaKind).toBe("video");
    expect(wrapper.vm.previewSourceMode).toBe("output");
    expect(wrapper.vm.previewError).toBe("jobDetail.previewVideoError");
    wrapper.unmount();
  });
  it("does not restore an old video after a pending retry fails during a manual source change", async () => {
    backend.probe.mockResolvedValueOnce({ kind: "video", durationSeconds: 10 });
    const wrapper = mount(Harness);
    await wrapper.vm.openJobPreviewFromQueue(job());
    let rejectRetry!: (failure: Error) => void;
    backend.probe.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
    );
    const retry = wrapper.vm.handleExpandedPreviewError();
    await vi.waitFor(() => expect(backend.probe).toHaveBeenCalledTimes(2));
    await wrapper.vm.setPreviewSourceMode("output");
    rejectRetry(new Error("old retry failed"));
    await retry;
    expect(wrapper.vm.previewMediaKind).toBe("audio");
    expect(wrapper.vm.previewUrl).toBe("asset:out.mkv");
    expect(wrapper.vm.previewError).toBeNull();
    wrapper.unmount();
  });
  it("ignores pending probes after closing and reopening the same job", async () => {
    let complete!: (info: { kind: string; durationSeconds: null }) => void;
    backend.probe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const wrapper = mount(Harness);
    const opening = wrapper.vm.openJobPreviewFromQueue(job());
    await vi.waitFor(() => expect(backend.probe).toHaveBeenCalledTimes(1));
    wrapper.vm.closeExpandedPreview();
    await wrapper.vm.openJobPreviewFromQueue(job());
    complete({ kind: "video", durationSeconds: null });
    await opening;
    expect(wrapper.vm.previewMediaKind).toBe("audio");
    expect(wrapper.vm.previewUrl).toBe("asset:out.mkv");
    wrapper.unmount();
  });
  it("does not reopen a dialog from a stale initial path selection", async () => {
    let complete!: (path: string) => void;
    backend.select.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const wrapper = mount(Harness);
    const opening = wrapper.vm.openJobPreviewFromQueue(job());
    wrapper.vm.closeExpandedPreview();
    complete("out.mkv");
    await opening;
    expect(wrapper.vm.dialogManager.previewOpen.value).toBe(false);
    expect(wrapper.vm.previewUrl).toBeNull();
    expect(backend.probe).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
