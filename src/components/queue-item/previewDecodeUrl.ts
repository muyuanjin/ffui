import { markPreviewDecoded } from "@/components/queue-item/previewWarmCache";

export const decodeUrl = async (jobId: string, url: string, signal: AbortSignal) => {
  if (signal.aborted) return;
  if (typeof Image !== "function") {
    markPreviewDecoded(jobId, url);
    return;
  }

  const img = new Image();
  (img as any).decoding = "async";
  img.src = url;

  const raceAbort = async <T>(promise: Promise<T>) => {
    if (signal.aborted) throw new Error("aborted");
    let onAbort: (() => void) | null = null;
    const abortPromise = new Promise<never>((_, reject) => {
      onAbort = () => {
        try {
          img.onload = null;
          img.onerror = null;
          img.src = "";
        } catch {
          // ignore
        }
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", onAbort);
    });
    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  };

  const decode = (img as any).decode;
  if (typeof decode === "function") {
    await raceAbort(decode.call(img));
  } else {
    await raceAbort(
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
      }),
    );
  }

  if (signal.aborted) return;
  markPreviewDecoded(jobId, url);
};
