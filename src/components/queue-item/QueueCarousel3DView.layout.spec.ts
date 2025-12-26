// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import QueueCarousel3DView from "./QueueCarousel3DView.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { QueueListItem } from "@/composables";
import type { TranscodeJob } from "@/types";

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null | undefined) => path ?? null,
    buildJobPreviewUrl: (path: string | null | undefined) => path ?? null,
    ensureJobPreview: vi.fn(async () => null),
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

const makeJob = (id: string): TranscodeJob =>
  ({
    id,
    filename: `C:/videos/${id}.mp4`,
    type: "video",
    source: "manual",
    originalSizeMB: 1,
    presetId: "p1",
    status: "queued",
    progress: 0,
    logs: [],
  }) as TranscodeJob;

describe("QueueCarousel3DView layout guardrails", () => {
  it("creates a stacking context for the stage so card z-index cannot cover header/pagination", () => {
    const items: QueueListItem[] = [
      { kind: "job", job: makeJob("job-1") },
      { kind: "job", job: makeJob("job-2") },
    ];

    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items,
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          Progress: true,
          QueueJobWarnings: true,
        },
      },
    });

    const stage = wrapper.get("[data-testid='ffui-carousel-3d-stage']");
    expect(stage.classes()).toContain("z-0");

    const header = wrapper.get("[data-testid='ffui-carousel-3d-header']");
    const footer = wrapper.get("[data-testid='ffui-carousel-3d-hint']").element.parentElement!;
    expect(header.classes()).toContain("z-10");
    expect(footer.classList).toContain("z-10");
  });

  it("renders stable test ids for screenshot automation and regression checks", () => {
    const items: QueueListItem[] = Array.from({ length: 3 }, (_, idx) => ({
      kind: "job" as const,
      job: makeJob(`job-${idx + 1}`),
    }));

    const wrapper = mount(QueueCarousel3DView, {
      props: {
        items,
        selectedJobIds: new Set<string>(),
        progressStyle: "bar",
        autoRotationSpeed: 0,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          Progress: true,
          QueueJobWarnings: true,
        },
      },
    });

    expect(wrapper.find("[data-testid='ffui-carousel-3d-container']").exists()).toBe(true);
    expect(wrapper.findAll("[data-testid='ffui-carousel-3d-card']").length).toBeGreaterThan(0);
    expect(wrapper.find("[data-testid='ffui-carousel-3d-pagination']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-carousel-3d-hint']").exists()).toBe(true);
  });
});
