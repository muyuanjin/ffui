import { invoke } from "@tauri-apps/api/core";

export const cleanupPreviewCachesAsync = async (): Promise<boolean> => {
  return invoke<boolean>("cleanup_preview_caches_async");
};

