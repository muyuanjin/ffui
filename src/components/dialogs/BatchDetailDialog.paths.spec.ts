// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import BatchDetailDialog from "./BatchDetailDialog.vue";
import {
  createMockBatch,
  createMockJob,
  createMockPreset,
  createMountOptions,
} from "./__tests__/BatchDetailDialog.test-utils";
import type { TranscodeJob } from "@/types";

const boundary = vi.hoisted(() => ({ tauri: true, reveal: vi.fn(), copy: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  hasTauri: () => boundary.tauri,
  revealPathInFolder: boundary.reveal,
  buildPreviewUrl: (path: string) => path,
}));
vi.mock("@/lib/copyToClipboard", () => ({ copyToClipboard: boundary.copy }));

const wrappers: VueWrapper[] = [];
const mountBatch = (job: TranscodeJob) => {
  const options = createMountOptions(createMockBatch([job]), [createMockPreset("p1")]);
  const wrapper = mount(BatchDetailDialog, {
    ...options,
    attachTo: document.body,
    global: { ...options.global, stubs: { ...options.global.stubs, QueueContextMenu: false } },
  });
  wrappers.push(wrapper);
  return wrapper;
};
const openMenu = async (wrapper: VueWrapper) => {
  await flushPromises();
  await wrapper.get('[data-testid="queue-item-stub"]').trigger("contextmenu", { clientX: 20, clientY: 30 });
  await flushPromises();
};
const item = (name: string) => new DOMWrapper(document.querySelector(`[data-testid="queue-context-menu-${name}"]`)!);

beforeEach(() => {
  boundary.tauri = true;
  boundary.reveal.mockReset();
  boundary.copy.mockReset();
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

describe("batch detail output path actions", () => {
  it("copies and reveals the recorded output through the real context menu", async () => {
    const job = { ...createMockJob("known", "completed"), type: "audio" as const, outputPath: "D:/输出/result.mp3" };
    const wrapper = mountBatch(job);
    await openMenu(wrapper);
    expect(item("copy-output").attributes("aria-disabled")).not.toBe("true");
    await item("copy-output").trigger("click");
    expect(boundary.copy).toHaveBeenCalledExactlyOnceWith(job.outputPath);
    await openMenu(wrapper);
    expect(item("open-output").attributes("aria-disabled")).not.toBe("true");
    await item("open-output").trigger("click");
    expect(boundary.reveal).toHaveBeenCalledExactlyOnceWith(job.outputPath);
  });

  it("copies known output without Tauri but disables native location", async () => {
    boundary.tauri = false;
    const job = { ...createMockJob("browser", "completed"), outputPath: "D:/result.mp3" };
    const wrapper = mountBatch(job);
    await openMenu(wrapper);
    expect(item("copy-output").attributes("aria-disabled")).not.toBe("true");
    expect(item("open-output").attributes("aria-disabled")).toBe("true");
    expect(item("open-input").attributes("aria-disabled")).toBe("true");
    await item("copy-output").trigger("click");
    expect(boundary.copy).toHaveBeenCalledExactlyOnceWith(job.outputPath);
    expect(boundary.reveal).not.toHaveBeenCalled();
  });

  it("disables unknown output instead of copying or revealing the input", async () => {
    const wrapper = mountBatch(createMockJob("unknown", "completed"));
    await openMenu(wrapper);
    expect(item("copy-output").attributes("aria-disabled")).toBe("true");
    expect(item("open-output").attributes("aria-disabled")).toBe("true");
    await item("copy-output").trigger("click");
    await item("open-output").trigger("click");
    expect(boundary.copy).not.toHaveBeenCalled();
    expect(boundary.reveal).not.toHaveBeenCalled();
  });

  it("uses a recorded temporary output address without inventing an output", async () => {
    const job = { ...createMockJob("paused", "paused"), waitMetadata: { tmpOutputPath: "D:/输出/part.mp3" } };
    const wrapper = mountBatch(job);
    await openMenu(wrapper);
    await item("copy-output").trigger("click");
    expect(boundary.copy).toHaveBeenCalledExactlyOnceWith(job.waitMetadata.tmpOutputPath);
  });
});
