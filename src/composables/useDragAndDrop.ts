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

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    isDragging.value = true;
  };

  const handleDragLeave = () => {
    isDragging.value = false;
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    isDragging.value = false;

    // 浏览器拖放处理
    if (e.dataTransfer?.files) {
      const paths: string[] = [];
      for (const file of e.dataTransfer.files) {
        // @ts-expect-error - file.path is available in Electron/Tauri
        paths.push(file.path || file.name);
      }
      if (paths.length > 0 && onFilesDropped) {
        onFilesDropped(paths);
      }
    }
  };

  onMounted(async () => {
    if (hasTauri()) {
      // Tauri 拖放监听
      dragDropUnlisten = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        (event) => {
          const paths = event.payload.paths;
          if (paths && paths.length > 0 && onFilesDropped) {
            onFilesDropped(paths);
          }
        }
      );
    }
  });

  onUnmounted(() => {
    if (dragDropUnlisten) {
      dragDropUnlisten();
    }
  });

  return {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
