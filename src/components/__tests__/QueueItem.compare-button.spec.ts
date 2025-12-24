// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import en from "@/locales/en";
import { i18n, basePreset, makeJob } from "./queueItemDisplayTestUtils";

vi.mock("@/lib/backend", () => {
  const hasTauri = vi.fn(() => false);
  const loadPreviewDataUrl = vi.fn(async (path: string) => `data:image/jpeg;base64,TEST:${path}`);

  return {
    buildPreviewUrl: (path: string | null) => path,
    buildJobPreviewUrl: (path: string | null, revision?: number | null) =>
      path && revision && hasTauri() ? `${path}?ffuiPreviewRev=${revision}` : path,
    hasTauri,
    loadPreviewDataUrl,
    selectPlayableMediaPath: vi.fn(async (candidates: string[]) => candidates[0] ?? null),
  };
});

vi.mock("@/lib/ffmpegCommand", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ffmpegCommand")>("@/lib/ffmpegCommand");
  return {
    ...actual,
    highlightFfmpegCommand: (command: string) => command,
    normalizeFfmpegTemplate: (command: string) => ({
      template: command ? `TEMPLATE:${command}` : "",
    }),
  };
});

import { hasTauri } from "@/lib/backend";
import QueueItem from "@/components/QueueItem.vue";

describe("QueueItem compare button", () => {
  beforeEach(() => {
    (hasTauri as any).mockReset();
    (hasTauri as any).mockReturnValue(false);
    i18n.global.locale.value = "en";
  });

  it("renders a compare button on video cards and disables it when Tauri is unavailable", () => {
    const job = makeJob({
      status: "completed",
      outputPath: "C:/videos/sample.compressed.mp4",
    });

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const compareButton = wrapper.get("[data-testid='queue-item-compare-button']");
    expect((compareButton.element as HTMLButtonElement).disabled).toBe(true);
    expect(compareButton.attributes("title")).toBe((en as any).jobCompare.requiresTauri);
  });

  it("emits compare when the compare button is clicked", async () => {
    const job = makeJob({
      status: "completed",
      outputPath: "C:/videos/sample.compressed.mp4",
    });

    (hasTauri as any).mockReturnValue(true);

    const wrapper = mount(QueueItem, {
      props: {
        job,
        preset: basePreset,
        canCancel: true,
      },
      global: {
        plugins: [i18n],
      },
    });

    const compareButton = wrapper.get("[data-testid='queue-item-compare-button']");
    expect((compareButton.element as HTMLButtonElement).disabled).toBe(false);

    await compareButton.trigger("click");
    expect(wrapper.emitted("compare")?.[0]?.[0]).toEqual(job);
  });
});
