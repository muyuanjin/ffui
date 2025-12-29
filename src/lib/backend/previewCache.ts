import { invokeWithAliases } from "./invokeWithAliases";

export const cleanupPreviewCachesAsync = async (): Promise<boolean> => {
  return invokeWithAliases<boolean>("cleanup_preview_caches_async");
};
