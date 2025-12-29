import { invokeCommand } from "./invokeCommand";

export const cleanupPreviewCachesAsync = async (): Promise<boolean> => {
  return invokeCommand<boolean>("cleanup_preview_caches_async");
};
