import { ref, onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { hasTauri } from "@/lib/backend";

/**
 * 拖放处理 Composable 配置选项
 */
export interface UseDragAndDropOptions {
  /** 文件拖放完成时的回调函数 */
  onFilesDropped?: (paths: string[]) => void;
}

/**
 * 拖放处理 Composable
 *
 * @description 处理文件拖放到应用窗口的逻辑,支持浏览器和 Tauri 环境
 * @param options - 配置选项
 * @returns 拖放状态和事件处理器
 *
 * @example
 * ```typescript
 * const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragAndDrop({
 *   onFilesDropped: (paths) => {
 *     console.log("Dropped files:", paths);
 *   }
 * });
 * ```
 */
export function useDragAndDrop(options: UseDragAndDropOptions = {}) {
  const { onFilesDropped } = options;

  const isDragging = ref(false);
  let dragDropUnlisten: UnlistenFn | null = null;

  const isFileDragEvent = (e: DragEvent): boolean => {
    // In browsers, dataTransfer.types contains 'Files' when dragging files from OS.
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).includes("Files")) return true;
    // Some environments expose items with kind === 'file'.
    const items = e.dataTransfer?.items;
    if (items && Array.from(items).some((it) => it.kind === "file")) return true;
    // During drop, some environments only populate `dataTransfer.files`.
    const filesLen = e.dataTransfer?.files?.length ?? 0;
    if (filesLen > 0) return true;
    return false;
  };

  const handleDragOver = (e: DragEvent) => {
    // Even if we cannot confidently detect a file drag (e.g. tests provide a
    // minimal stub event), we still surface the dragging overlay so UX remains
    // responsive. Only call preventDefault() when it's a file drag to avoid
    // interfering with text selections.
    if (isFileDragEvent(e)) {
      e.preventDefault();
    }
    isDragging.value = true;
  };

  const handleDragLeave = () => {
    isDragging.value = false;
  };

  const handleDrop = async (e: DragEvent) => {
    const isFile = isFileDragEvent(e);
    const files = e.dataTransfer?.files ?? null;
    const hasFiles = !!files && files.length > 0;
    if (isFile || hasFiles) e.preventDefault();
    isDragging.value = false;

    // 浏览器拖放处理（在部分环境只在 drop 阶段提供 files）
    if ((isFile || hasFiles) && files) {
      const paths: string[] = [];
      for (const file of Array.from(files)) {
        // 在 Electron/Tauri 环境下 file.path 存在；在浏览器环境下退回 file.name。
        const filePath = "path" in file ? (file as { path?: unknown }).path : undefined;
        paths.push(typeof filePath === "string" && filePath.trim().length > 0 ? filePath : file.name);
      }
      if (paths.length > 0 && onFilesDropped) {
        onFilesDropped(paths);
      }
    }
  };

  onMounted(async () => {
    if (hasTauri()) {
      // Tauri 拖放监听
      try {
        dragDropUnlisten = await listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
          const paths = event.payload.paths;
          if (paths && paths.length > 0 && onFilesDropped) {
            onFilesDropped(paths);
          }
        });
      } catch (error) {
        console.error("Failed to listen for tauri drag-drop events:", error);
        dragDropUnlisten = null;
      }
    }
  });

  onUnmounted(() => {
    if (dragDropUnlisten) {
      try {
        dragDropUnlisten();
      } catch (error) {
        console.error("Failed to unlisten tauri drag-drop events:", error);
      } finally {
        dragDropUnlisten = null;
      }
    }
  });

  return {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
