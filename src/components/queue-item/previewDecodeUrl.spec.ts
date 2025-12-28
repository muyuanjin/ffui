// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { decodeUrl } from "@/components/queue-item/previewDecodeUrl";
import { getDecodedPreviewUrl, resetPreviewWarmCacheForTests } from "@/components/queue-item/previewWarmCache";

describe("previewDecodeUrl", () => {
  const jobId = "job-1";
  const url = "https://example.invalid/preview.jpg";

  beforeEach(() => {
    resetPreviewWarmCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks decoded when Image is not available", async () => {
    vi.stubGlobal("Image", undefined);
    await decodeUrl(jobId, url, new AbortController().signal);
    expect(getDecodedPreviewUrl(jobId, url)).toBe(url);
  });

  it("rejects on abort and does not mark decoded", async () => {
    class PendingDecodeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      decoding: any = null;
      decode() {
        return new Promise<void>(() => {});
      }
    }

    vi.stubGlobal("Image", PendingDecodeImage as any);

    const abortController = new AbortController();
    const promise = decodeUrl(jobId, url, abortController.signal);
    abortController.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
    expect(getDecodedPreviewUrl(jobId, url)).toBe(null);
  });

  it("marks decoded after a successful decode()", async () => {
    class SuccessfulDecodeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      decoding: any = null;
      decode() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal("Image", SuccessfulDecodeImage as any);

    await decodeUrl(jobId, url, new AbortController().signal);
    expect(getDecodedPreviewUrl(jobId, url)).toBe(url);
  });
});
