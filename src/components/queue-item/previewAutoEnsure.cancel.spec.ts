// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ensureJobPreviewMock = vi.fn<(jobId: string) => Promise<string | null>>(async (_jobId) => "C:/previews/x.jpg");

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
    ensureJobPreview: (jobId: string) => ensureJobPreviewMock(jobId),
  };
});

import { requestJobPreviewAutoEnsure, resetPreviewAutoEnsureForTests } from "./previewAutoEnsure";

describe("previewAutoEnsure (cancellation)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ensureJobPreviewMock.mockClear();
    (window as any).requestIdleCallback = undefined;
    (window as any).requestAnimationFrame = undefined;
    resetPreviewAutoEnsureForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels a queued ensure before it starts", async () => {
    const handle = requestJobPreviewAutoEnsure("job-cancel");
    handle.cancel();

    await vi.runAllTimersAsync();
    await expect(handle.promise).resolves.toBe(null);
    expect(ensureJobPreviewMock).toHaveBeenCalledTimes(0);
  });
});
