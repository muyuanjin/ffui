// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import type { QueueListItem } from "@/composables";
import type { QueueStateLiteDelta, TranscodeJob } from "@/types";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";

import {
  applyQueueStateFromBackend,
  applyQueueStateLiteDeltaFromBackend,
  type StateSyncDeps,
} from "@/composables/queue/operations-state-sync";

const MAX_RENDERED_ROWS_FOR_TEST = 30;

vi.mock("virtua/vue", async () => {
  const { defineComponent, h } = await import("vue");

  const VList = defineComponent({
    props: {
      data: { type: Array, required: true },
      bufferSize: { type: Number, required: false, default: undefined },
      itemSize: { type: Number, required: false, default: undefined },
    },
    setup(props, { slots }) {
      return () => {
        const items = (props.data as unknown[]).slice(0, MAX_RENDERED_ROWS_FOR_TEST);
        return h(
          "div",
          {
            "data-testid": "virtua-vlist-stub",
            "data-buffer-size": String(props.bufferSize ?? ""),
            "data-item-size": String(props.itemSize ?? ""),
          },
          items.flatMap((item, index) => slots.default?.({ item, index }) ?? []),
        );
      };
    },
  });

  return { VList };
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

const nowMs = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const makeDeps = (jobs: Ref<TranscodeJob[]>): StateSyncDeps => {
  return {
    jobs,
    queueError: ref<string | null>(null),
    lastQueueSnapshotAtMs: ref<number | null>(null),
    lastQueueSnapshotRevision: ref<number | null>(null),
  };
};

const makeJobTemplate = (i: number, status: TranscodeJob["status"]): TranscodeJob => {
  const id = `job-${i}`;
  const filename = `C:/videos/sim/${String(i).padStart(4, "0")}-sample.mp4`;
  return {
    id,
    filename,
    type: "video",
    source: i % 3 === 0 ? "batch_compress" : "manual",
    originalSizeMB: 120 + (i % 900),
    originalCodec: "h264",
    presetId: "preset-1",
    status,
    progress: status === "processing" ? 0 : 0,
    logs: [],
    logTail: "",
    elapsedMs: 0,
  } as TranscodeJob;
};

const shallowCloneJob = (job: TranscodeJob): TranscodeJob => ({ ...(job as any) }) as TranscodeJob;

const buildSnapshotJobs = (templates: TranscodeJob[], progressById: Map<string, number>): TranscodeJob[] => {
  const out: TranscodeJob[] = new Array(templates.length);
  for (let i = 0; i < templates.length; i += 1) {
    const next = shallowCloneJob(templates[i]);
    const progress = progressById.get(next.id);
    if (typeof progress === "number") {
      next.progress = progress;
      next.elapsedMs = Math.floor(progress * 1000);
      next.logTail = `progress=${progress.toFixed(2)}`;
    }
    out[i] = next;
  }
  return out;
};

const makeQueueItems = (jobs: TranscodeJob[]): QueueListItem[] =>
  jobs.map((job) => ({ kind: "job", job }) as QueueListItem);

type UiPerfResult = {
  jobs: number;
  processing: number;
  baselineSnapshotTicks: number;
  baselineSnapshotAvgMs: number;
  deltaTicks: number;
  deltaAvgMs: number;
  renderedRows: number;
  notes: string[];
};

describe("perf: QueuePanel reactive update costs (manual)", () => {
  it("prints UI pipeline timing for 100 jobs with 2 processing", async () => {
    const jobsCount = 100;
    const processingCount = 2;

    const templates: TranscodeJob[] = [];
    for (let i = 0; i < jobsCount; i += 1) {
      const status: TranscodeJob["status"] = i < processingCount ? "processing" : "queued";
      templates.push(makeJobTemplate(i, status));
    }

    const jobsRef = ref<TranscodeJob[]>(templates.map((j) => shallowCloneJob(j)));
    const deps = makeDeps(jobsRef);

    let queueItemRenders = 0;
    const QueueItemStub = defineComponent({
      name: "QueueItem",
      props: {
        job: { type: Object, required: true },
      },
      setup(props) {
        return () => {
          queueItemRenders += 1;
          return h(
            "div",
            {
              "data-testid": "queue-item-stub",
              "data-job-id": (props as any).job?.id ?? "",
            },
            (props as any).job?.filename ?? "",
          );
        };
      },
    });

    const QueuePanelComponent: any = (await import("@/components/panels/QueuePanel.vue")).default;

    const Harness = defineComponent({
      name: "QueuePanelHarness",
      setup() {
        const queueJobsForDisplay = computed(() => jobsRef.value);
        const queueModeProcessingJobs = computed(() =>
          jobsRef.value.filter((job) => job.status === "processing" || job.status === "paused"),
        );
        const queueModeWaitingItems = computed(() =>
          makeQueueItems(jobsRef.value.filter((job) => job.status === "queued")),
        );
        const visibleQueueItems = computed(() => queueModeWaitingItems.value);
        const iconViewItems = computed(() => visibleQueueItems.value);

        return () =>
          h(QueuePanelComponent, {
            queueJobsForDisplay: queueJobsForDisplay.value,
            visibleQueueItems: visibleQueueItems.value,
            iconViewItems: iconViewItems.value,
            queueModeProcessingJobs: queueModeProcessingJobs.value,
            queueModeWaitingItems: queueModeWaitingItems.value,
            queueModeWaitingBatchIds: new Set<string>(),
            pausingJobIds: new Set<string>(),
            presets: [],
            queueViewMode: "list",
            ffmpegResolvedPath: null,
            queueProgressStyle: "bar",
            queueMode: "queue",
            isIconViewMode: false,
            isCarousel3dViewMode: false,
            carouselAutoRotationSpeed: 0,
            iconViewSize: "medium",
            iconGridClass: "",
            queueRowVariant: "detail",
            progressUpdateIntervalMs: 250,
            hasBatchCompressBatches: false,
            activeStatusFilters: new Set(),
            activeTypeFilters: new Set(),
            filterText: "",
            filterUseRegex: false,
            filterRegexError: null,
            sortPrimary: "filename",
            sortPrimaryDirection: "asc",
            hasSelection: false,
            hasActiveFilters: false,
            selectedJobIds: new Set<string>(),
            selectedCount: 0,
            expandedBatchIds: new Set<string>(),
          });
      },
    });

    const wrapper = mount(Harness, {
      attrs: { style: "height: 600px; width: 800px;" },
      global: {
        plugins: [i18n],
        stubs: {
          QueueItem: QueueItemStub,
        },
      },
    });

    // Warm up initial snapshot + first render.
    applyQueueStateFromBackend(
      {
        snapshotRevision: 1,
        jobs: buildSnapshotJobs(
          templates,
          new Map([
            ["job-0", 1],
            ["job-1", 1],
          ]),
        ),
      } as any,
      deps,
    );
    await nextTick();
    queueItemRenders = 0;

    const baselineTicks = 20;
    let baselineTotal = 0;
    for (let tick = 0; tick < baselineTicks; tick += 1) {
      const progress = 1 + tick * 0.5;
      const progressById = new Map<string, number>([
        ["job-0", progress],
        ["job-1", progress],
      ]);
      const snapshotJobs = buildSnapshotJobs(templates, progressById);
      const started = nowMs();
      applyQueueStateFromBackend({ snapshotRevision: 2 + tick, jobs: snapshotJobs } as any, deps);
      await nextTick();
      baselineTotal += nowMs() - started;
    }

    const baseSnapshotRevision = 2 + baselineTicks;
    deps.lastQueueSnapshotRevision.value = baseSnapshotRevision;

    const deltaTicks = 200;
    let deltaTotal = 0;
    for (let tick = 0; tick < deltaTicks; tick += 1) {
      const progress = 20 + tick * 0.1;
      const delta: QueueStateLiteDelta = {
        baseSnapshotRevision,
        deltaRevision: tick + 1,
        patches: [
          {
            id: "job-0",
            progress,
            elapsedMs: 1000 + tick,
            logTail: `progress=${progress.toFixed(2)}`,
          },
          {
            id: "job-1",
            progress,
            elapsedMs: 1000 + tick,
            logTail: `progress=${progress.toFixed(2)}`,
          },
        ],
      };
      const started = nowMs();
      applyQueueStateLiteDeltaFromBackend(delta, deps);
      await nextTick();
      deltaTotal += nowMs() - started;
    }

    const renderedRows = wrapper.findAll("[data-testid='queue-item-stub']").length;

    const result: UiPerfResult = {
      jobs: jobsCount,
      processing: processingCount,
      baselineSnapshotTicks: baselineTicks,
      baselineSnapshotAvgMs: round3(baselineTotal / baselineTicks),
      deltaTicks,
      deltaAvgMs: round3(deltaTotal / deltaTicks),
      renderedRows,
      notes: [
        "This measures apply + Vue update flush (nextTick) with QueuePanel mounted (virtua is stubbed).",
        "If baseline is high at 100 jobs in your environment, the remaining bottleneck is likely render/computed work beyond apply itself.",
        "Run with: pnpm run bench:queue",
      ],
    };

    expect(result.renderedRows).toBeGreaterThan(0);
    expect(result.renderedRows).toBeLessThanOrEqual(MAX_RENDERED_ROWS_FOR_TEST);
    expect(result.deltaAvgMs).toBeGreaterThanOrEqual(0);
    expect(result.deltaAvgMs).toBeLessThanOrEqual(5);
    expect(result.baselineSnapshotAvgMs / Math.max(result.deltaAvgMs, 1e-9)).toBeGreaterThanOrEqual(3);

    // eslint-disable-next-line no-console
    console.log(
      "[perf] queue UI pipeline benchmark:",
      JSON.stringify(result, null, 2),
      `queueItemRenders=${queueItemRenders}`,
    );
  }, 60_000);
});
