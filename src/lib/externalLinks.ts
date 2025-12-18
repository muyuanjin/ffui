import { hasTauri } from "@/lib/backend";

export const openExternalUrl = async (url: string): Promise<void> => {
  const normalized = String(url ?? "").trim();
  if (!normalized) return;

  if (hasTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(normalized);
      return;
    } catch (error) {
      console.error("open external url via tauri opener failed", error);
    }
  }

  try {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(normalized, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    console.error("open external url via window.open failed", error);
  }
};
