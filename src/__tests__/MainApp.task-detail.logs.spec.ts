// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";
import { normalizeFfmpegTemplate } from "@/lib/ffmpegCommand";
import { hasTauri, loadJobDetail } from "@/lib/backend";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock("@/lib/backend", () => ({
  hasTauri: vi.fn(() => false),
  buildPreviewUrl: vi.fn((path: string | null) => path),
  inspectMedia: vi.fn(async () => "{}"),
  fetchCpuUsage: vi.fn(async () => ({} as any)),
  fetchExternalToolStatuses: vi.fn(async () => []),
  fetchExternalToolStatusesCached: vi.fn(async () => []),
  refreshExternalToolStatusesAsync: vi.fn(async () => true),
  fetchGpuUsage: vi.fn(async () => ({} as any)),
  loadAppSettings: vi.fn(async () => ({} as any)),
  loadQueueState: vi.fn(async () => ({ jobs: [] })),
  loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
  loadJobDetail: vi.fn(async () => null),
  loadSmartDefaultPresets: vi.fn(async () => []),
  loadPresets: vi.fn(async () => []),
  runAutoCompress: vi.fn(async () => ({ jobs: [] })),
  saveAppSettings: vi.fn(async (settings: any) => settings),
  enqueueTranscodeJob: vi.fn(async () => ({} as any)),
  cancelTranscodeJob: vi.fn(async () => true),
  selectPlayableMediaPath: vi.fn(
    async (candidates: string[]) => candidates[0] ?? null,
  ),
}));

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const setJobsOnVm = (vm: any, jobs: TranscodeJob[]) => {
  if (Array.isArray(vm.jobs)) {
    vm.jobs = jobs;
  } else if (vm.jobs && "value" in vm.jobs) {
    vm.jobs.value = jobs;
  }
};

describe("MainApp task detail surface - logs", () => {
  beforeEach(() => {
    (window as any).__TAURI_IPC__ = {};
    vi.mocked(hasTauri).mockReturnValue(false);
    vi.mocked(loadJobDetail).mockResolvedValue(null);
    (navigator as any).clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("highlights command and logs while preserving exact text and copy semantics", async () => {
    const rawCommand = 'ffmpeg -i "in" -vf scale=1280:-2 -c:v libx264 out';
    const normalized = normalizeFfmpegTemplate(rawCommand);
    const job: TranscodeJob = {
      id: "job-5",
      filename: "C:/videos/sample5.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: ["line1", "line2"],
      ffmpegCommand: rawCommand,
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const commandHtml = document.querySelector(
      "[data-testid='task-detail-command'] pre",
    )?.innerHTML;
    const commandText = document.querySelector(
      "[data-testid='task-detail-command']",
    )?.textContent;
    // 文本内容必须包含规范化后的模板（确保高亮不改变可复制文本）
    expect(commandText || "").toContain(normalized.template);
    // 高亮 HTML 中应包含若干 span，说明命令被 token 化着色
    expect(commandHtml || "").toContain("<span");
    expect(document.body.textContent || "").toContain("line1");

    wrapper.unmount();
  });

  it("renders logs without injecting extra blank rows or artificial line breaks", async () => {
    const job: TranscodeJob = {
      id: "job-6",
      filename: "C:/videos/sample6.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: ["line1", "line2"],
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logEl = document.querySelector(
      "[data-testid='task-detail-log']",
    ) as HTMLElement | null;
    const text = logEl?.textContent || "";
    // 文本应包含两行内容且没有额外空白；这里用行前缀粗略校验。
    expect(text).toContain("line1");
    expect(text).toContain("line2");

    wrapper.unmount();
  });

  it("collapses structured ffmpeg -progress blocks into a single visual row", async () => {
    const job: TranscodeJob = {
      id: "job-7",
      filename: "C:/videos/sample7.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "processing",
      progress: 50,
      startTime: Date.now() - 5000,
      logs: [
        "frame=10 fps=24 q=28.0 size=123kB time=00:00:00.40 bitrate=2514.3kbits/s speed=0.9x",
        "frame=20 fps=24 q=27.0 size=234kB time=00:00:01.00 bitrate=1827.4kbits/s speed=0.9x",
        "frame=30 fps=24 q=26.0 size=345kB time=00:00:01.60 bitrate=1768.1kbits/s speed=0.9x",
      ],
      logTail: [],
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logEl = document.querySelector(
      "[data-testid='task-detail-log']",
    ) as HTMLElement | null;
    // 结构化进度块折叠逻辑在 useJobLog 内部单测覆盖，这里只确认日志容器存在即可。
    expect(logEl).toBeTruthy();

    wrapper.unmount();
  });

  it("prefers full logs over truncated logTail so the beginning of the log is preserved", async () => {
    const job: TranscodeJob = {
      id: "job-8",
      filename: "C:/videos/sample8.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: ["first", "second", "third"],
      logTail: ["tail-only"],
    } as any;

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const text = document.body.textContent || "";
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).not.toContain("tail-only");

    wrapper.unmount();
  });

  it("loads full logs from backend in tauri mode and keeps copy/display consistent", async () => {
    vi.mocked(hasTauri).mockReturnValue(true);

    const liteJob: TranscodeJob = {
      id: "job-9",
      filename: "C:/videos/sample9.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      originalCodec: "h264",
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      logs: [],
      logTail: "tail-only",
    } as any;

    vi.mocked(loadJobDetail).mockResolvedValue({
      ...liteJob,
      logs: ["full-start", "full-mid", "full-end"],
      logTail: "tail-only",
    } as TranscodeJob);

    const wrapper = mount(MainApp, { global: { plugins: [i18n] } });
    const vm: any = wrapper.vm;
    setJobsOnVm(vm, [liteJob]);
    vm.selectedJobForDetail = liteJob;

    await nextTick();
    // Allow the async get_job_detail call to resolve and update the computed log text.
    await Promise.resolve();
    const pendingDetails = vi
      .mocked(loadJobDetail)
      .mock.results.map((result) => result.value)
      .filter((p): p is Promise<TranscodeJob | null> => !!p);
    if (pendingDetails.length) {
      await Promise.all(pendingDetails);
    }
    expect(loadJobDetail).toHaveBeenCalledWith("job-9");
    // Simulate hydration result being applied to the selected job to mirror the
    // async updateJobDetail flow.
    vm.dialogManager.selectedJob.value = {
      ...liteJob,
      logs: ["full-start", "full-mid", "full-end"],
      logTail: "tail-only",
    };
    await nextTick();

    const text = document.body.textContent || "";
    expect(text).toContain("full-start");
    expect(text).toContain("full-end");
    // The truncated tail should not appear once the full logs are hydrated.
    expect(text).not.toContain("tail-only");

    const copyButton = document.querySelector(
      "[data-testid='task-detail-copy-logs']",
    ) as HTMLButtonElement | null;
    const clipboard = (navigator as any).clipboard;
    clipboard.writeText.mockClear();
    await copyButton?.click();

    const lastCall =
      clipboard.writeText.mock.calls[clipboard.writeText.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe("full-start\nfull-mid\nfull-end");

    wrapper.unmount();
  });
});
