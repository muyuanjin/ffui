// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import SkippedItemsStack from "./SkippedItemsStack.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { TranscodeJob } from "@/types";

vi.mock("@/lib/backend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backend")>("@/lib/backend");
  return {
    ...actual,
    hasTauri: () => false,
    buildPreviewUrl: (path: string | null | undefined) => path ?? null,
    buildJobPreviewUrl: (path: string | null | undefined) => path ?? null,
    ensureJobPreview: vi.fn(async () => null),
    revealPathInFolder: vi.fn(async () => undefined),
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
    status: "skipped",
    progress: 0,
    logs: [],
    skipReason: "No matching preset",
  }) as TranscodeJob;

describe("SkippedItemsStack wheel soft snap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not preventDefault when already at the boundary and cannot step", async () => {
    const jobs = [makeJob("job-1"), makeJob("job-2")];
    const wrapper = mount(SkippedItemsStack, {
      props: { skippedJobs: jobs, maxStackLayers: 5 },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          DropdownMenu: true,
          DropdownMenuContent: true,
          DropdownMenuItem: true,
          DropdownMenuTrigger: true,
        },
      },
    });

    const container = wrapper.get(".skipped-stack-container").element;

    const wheelUpAtStart = new WheelEvent("wheel", { deltaY: -140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(wheelUpAtStart);
    await wrapper.vm.$nextTick();

    expect(wheelUpAtStart.defaultPrevented).toBe(false);
    expect(wrapper.get("[data-testid='ffui-skipped-stack-position']").text()).toContain("1 / 2");
  });

  it("preventsDefault only when a step actually happens", async () => {
    const jobs = [makeJob("job-1"), makeJob("job-2")];
    const wrapper = mount(SkippedItemsStack, {
      props: { skippedJobs: jobs, maxStackLayers: 5 },
      global: {
        plugins: [i18n],
        stubs: {
          Badge: true,
          Button: true,
          DropdownMenu: true,
          DropdownMenuContent: true,
          DropdownMenuItem: true,
          DropdownMenuTrigger: true,
        },
      },
    });

    const container = wrapper.get(".skipped-stack-container").element;

    const wheelDown = new WheelEvent("wheel", { deltaY: 140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(wheelDown);
    await wrapper.vm.$nextTick();

    expect(wheelDown.defaultPrevented).toBe(true);
    expect(wrapper.get("[data-testid='ffui-skipped-stack-position']").text()).toContain("2 / 2");

    const wheelDownAtEnd = new WheelEvent("wheel", { deltaY: 140, cancelable: true, deltaMode: 0 });
    container.dispatchEvent(wheelDownAtEnd);
    await wrapper.vm.$nextTick();

    expect(wheelDownAtEnd.defaultPrevented).toBe(false);
  });
});
