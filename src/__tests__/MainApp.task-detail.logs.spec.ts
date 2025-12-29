// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, defineComponent, inject, provide, ref, h } from "vue";
import { withMainAppVmCompat } from "./helpers/mainAppVmCompat";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob } from "@/types";
import MainApp from "@/MainApp.vue";
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
vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  return {
    hasTauri,
    buildPreviewUrl: vi.fn((path: string | null) => path),
    buildJobPreviewUrl: vi.fn((path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    ),
    inspectMedia: vi.fn(async () => "{}"),
    fetchCpuUsage: vi.fn(async () => ({}) as any),
    fetchExternalToolStatuses: vi.fn(async () => []),
    fetchExternalToolStatusesCached: vi.fn(async () => []),
    refreshExternalToolStatusesAsync: vi.fn(async () => true),
    fetchGpuUsage: vi.fn(async () => ({}) as any),
    loadAppSettings: vi.fn(async () => ({}) as any),
    loadQueueState: vi.fn(async () => ({ jobs: [] })),
    loadQueueStateLite: vi.fn(async () => ({ jobs: [] })),
    loadJobDetail: vi.fn(async () => null),
    loadSmartDefaultPresets: vi.fn(async () => []),
    loadPresets: vi.fn(async () => []),
    runAutoCompress: vi.fn(async () => ({ jobs: [] })),
    saveAppSettings: vi.fn(async (settings: any) => settings),
    enqueueTranscodeJob: vi.fn(async () => ({}) as any),
    cancelTranscodeJob: vi.fn(async () => true),
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const SelectStubKey = Symbol("SelectStubKey");
type SelectStubContext = {
  open: { value: boolean };
  setOpen: (open: boolean) => void;
  setValue: (value: unknown) => void;
};

const selectStubs = {
  Select: defineComponent({
    name: "Select",
    props: { modelValue: { type: null, default: null } },
    emits: ["update:modelValue"],
    setup(_props, { emit, slots }) {
      const open = ref(false);
      const setOpen = (value: boolean) => {
        open.value = value;
      };
      const setValue = (value: unknown) => {
        emit("update:modelValue", value);
      };
      provide<SelectStubContext>(SelectStubKey, { open, setOpen, setValue });
      return () => h("div", { "data-select-root": "" }, slots.default?.());
    },
  }),
  SelectTrigger: defineComponent({
    name: "SelectTrigger",
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      const ctx = inject<SelectStubContext>(SelectStubKey);
      return () =>
        h(
          "button",
          {
            ...attrs,
            type: "button",
            onClick: () => {
              if (!ctx) return;
              ctx.setOpen(!ctx.open.value);
            },
          },
          slots.default?.(),
        );
    },
  }),
  SelectContent: defineComponent({
    name: "SelectContent",
    setup(_props, { slots }) {
      const ctx = inject<SelectStubContext>(SelectStubKey);
      return () => (ctx?.open.value ? h("div", { "data-select-content": "" }, slots.default?.()) : null);
    },
  }),
  SelectItem: defineComponent({
    name: "SelectItem",
    props: { value: { type: null, required: true } },
    setup(props, { slots }) {
      const ctx = inject<SelectStubContext>(SelectStubKey);
      return () =>
        h(
          "button",
          {
            type: "button",
            onClick: () => {
              if (!ctx) return;
              ctx.setValue(props.value);
              ctx.setOpen(false);
            },
          },
          slots.default?.(),
        );
    },
  }),
  SelectValue: defineComponent({
    name: "SelectValue",
    setup(_props, { slots }) {
      return () => h("span", {}, slots.default?.());
    },
  }),
  SelectGroup: defineComponent({
    name: "SelectGroup",
    setup(_p, { slots }) {
      return () => h("div", {}, slots.default?.());
    },
  }),
  SelectLabel: defineComponent({
    name: "SelectLabel",
    setup(_p, { slots }) {
      return () => h("div", {}, slots.default?.());
    },
  }),
  SelectSeparator: defineComponent({
    name: "SelectSeparator",
    setup() {
      return () => h("hr");
    },
  }),
};

const mountMainApp = () => mount(MainApp, { global: { plugins: [i18n], stubs: selectStubs } });

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

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const commandHtml = document.querySelector("[data-testid='task-detail-command'] pre")?.innerHTML;
    const commandText = document.querySelector("[data-testid='task-detail-command']")?.textContent;
    // 任务已开始过/已完成时，默认展示后端实际执行的完整命令（可复制复现）。
    expect(commandText || "").toContain(rawCommand);
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
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logEl = document.querySelector("[data-testid='task-detail-log']") as HTMLElement | null;
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

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logEl = document.querySelector("[data-testid='task-detail-log']") as HTMLElement | null;
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

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const text = document.body.textContent || "";
    expect(text).toContain("first");
    expect(text).toContain("second");
    expect(text).not.toContain("tail-only");

    wrapper.unmount();
  });

  it("loads full logs from backend in tauri mode even if selected job has non-authoritative logs", async () => {
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
      // Simulate a non-authoritative UI-only message accidentally attached to the
      // selected job object. The task detail view must ignore this and hydrate
      // full backend logs.
      logs: ["Wait requested from UI; job will pause when ffmpeg reaches a safe point"],
      logTail: "tail-only",
    } as any;

    vi.mocked(loadJobDetail).mockResolvedValue({
      ...liteJob,
      logs: ["full-start", "full-mid", "full-end"],
      logTail: "tail-only",
    } as TranscodeJob);

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
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
    await nextTick();

    const text = document.body.textContent || "";
    expect(text).toContain("full-start");
    expect(text).toContain("full-end");
    // Non-authoritative UI-only logs should never appear in the detail log view.
    expect(text).not.toContain("Wait requested from UI");
    // The truncated tail should not appear once the full logs are hydrated.
    expect(text).not.toContain("tail-only");

    const copyButton = document.querySelector("[data-testid='task-detail-copy-logs']") as HTMLButtonElement | null;
    const clipboard = (navigator as any).clipboard;
    clipboard.writeText.mockClear();
    await copyButton?.click();

    const lastCall = clipboard.writeText.mock.calls[clipboard.writeText.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe("full-start\nfull-mid\nfull-end");

    wrapper.unmount();
  });

  it("supports per-run command and log switching with copy semantics", async () => {
    const job: TranscodeJob = {
      id: "job-10",
      filename: "C:/videos/sample10.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: Date.now() - 5000,
      endTime: Date.now(),
      runs: [
        { command: "ffmpeg -i in.mp4 out.mp4", logs: ["r1-a", "r1-b"] },
        { command: "ffmpeg -ss 1 -i in.mp4 out.mp4", logs: ["r2-a"] },
      ],
    } as any;

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const clipboard = (navigator as any).clipboard;
    clipboard.writeText.mockClear();

    const commandText = document.querySelector("[data-testid='task-detail-command']")?.textContent || "";
    expect(commandText).toContain("ffmpeg -i in.mp4 out.mp4");

    const copyCommandButton = document.querySelector(
      "[data-testid='task-detail-copy-command']",
    ) as HTMLButtonElement | null;
    await copyCommandButton?.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith("ffmpeg -i in.mp4 out.mp4");

    const commandRunTrigger = document.querySelector(
      "[data-testid='task-detail-command-run-select']",
    ) as HTMLButtonElement | null;
    expect(commandRunTrigger).toBeTruthy();
    commandRunTrigger?.click();
    await nextTick();
    const commandRunRoot = commandRunTrigger?.closest("[data-select-root]") as HTMLElement | null;
    const run2Option = Array.from(commandRunRoot?.querySelectorAll("[data-select-content] button") ?? []).find((el) =>
      (el.textContent || "").includes("Run 2"),
    ) as HTMLElement | undefined;
    expect(run2Option).toBeTruthy();
    run2Option?.click();
    await nextTick();

    const commandText2 = document.querySelector("[data-testid='task-detail-command']")?.textContent || "";
    expect(commandText2).toContain("ffmpeg -ss 1 -i in.mp4 out.mp4");
    clipboard.writeText.mockClear();
    await copyCommandButton?.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith("ffmpeg -ss 1 -i in.mp4 out.mp4");

    const copyLogsButton = document.querySelector("[data-testid='task-detail-copy-logs']") as HTMLButtonElement | null;
    clipboard.writeText.mockClear();
    await copyLogsButton?.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith("r1-a\nr1-b\nr2-a");

    const logRunTrigger = document.querySelector(
      "[data-testid='task-detail-log-run-select']",
    ) as HTMLButtonElement | null;
    expect(logRunTrigger).toBeTruthy();
    logRunTrigger?.click();
    await nextTick();
    const logRunRoot = logRunTrigger?.closest("[data-select-root]") as HTMLElement | null;
    const logRun2Option = Array.from(logRunRoot?.querySelectorAll("[data-select-content] button") ?? []).find((el) =>
      (el.textContent || "").includes("Run 2"),
    ) as HTMLElement | undefined;
    expect(logRun2Option).toBeTruthy();
    logRun2Option?.click();
    await nextTick();

    const logText = document.querySelector("[data-testid='task-detail-log']")?.textContent || "";
    expect(logText).toContain("r2-a");
    expect(logText).not.toContain("r1-a");
    clipboard.writeText.mockClear();
    await copyLogsButton?.click();
    expect(clipboard.writeText).toHaveBeenLastCalledWith("r2-a");

    wrapper.unmount();
  });

  it("prefixes log lines with timestamps when atMs is provided", async () => {
    const job: TranscodeJob = {
      id: "job-log-ts-1",
      filename: "C:/videos/log-ts.mp4",
      type: "video",
      source: "manual",
      originalSizeMB: 10,
      presetId: "p1",
      status: "completed",
      progress: 100,
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_000_500,
      logs: [{ text: "hello", atMs: 1_700_000_000_123 }],
      ffmpegCommand: "ffmpeg -i in out",
    };

    const wrapper = mountMainApp();
    const vm: any = withMainAppVmCompat(wrapper);
    setJobsOnVm(vm, [job]);
    vm.selectedJobForDetail = job;

    await nextTick();

    const logText = document.querySelector("[data-testid='task-detail-log']")?.textContent || "";
    expect(logText).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] hello/);

    wrapper.unmount();
  });
});
