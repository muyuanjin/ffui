import { ref, type Ref } from "vue";
import { EXTENSIONS } from "@/constants";
import { hasTauri } from "@/lib/backend";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

// ----- Composable -----

export interface UseFileInputOptions {
  /** Active tab ref. */
  activeTab: Ref<string>;
  /** Queue error ref. */
  queueError: Ref<string | null>;
  /** Last dropped root path. */
  lastDroppedRoot: Ref<string | null>;
  /** Callback to add a mock manual job (for non-Tauri). */
  addManualJobMock: () => void;
  /** Callback to enqueue a manual job from path. */
  enqueueManualJobFromPath: (path: string) => Promise<void>;
  /** Whether to show smart scan wizard after folder selection. */
  pendingSmartScanAfterFolder?: Ref<boolean>;
  /** Show smart scan ref. */
  showSmartScan?: Ref<boolean>;
  /** Optional i18n translation function. */
  t?: (key: string) => string;
}

export interface UseFileInputReturn {
  // ----- State -----
  /** Whether dragging over the drop zone. */
  isDragging: Ref<boolean>;
  /** File input element ref. */
  fileInputRef: Ref<HTMLInputElement | null>;
  /** Folder input element ref. */
  folderInputRef: Ref<HTMLInputElement | null>;

  // ----- Methods -----
  /** Handle file input change event. */
  handleFileInputChange: (event: Event) => Promise<void>;
  /** Handle folder input change event. */
  handleFolderInputChange: (event: Event) => void;
  /** Add manual job (opens file dialog or uses mock). */
  addManualJob: () => Promise<void>;
  /** Handle paths dropped onto queue. */
  handlePathsDroppedOntoQueue: (paths: string[]) => Promise<void>;
  /** Handle drag over event. */
  handleDragOver: (event: DragEvent) => void;
  /** Handle drag leave event. */
  handleDragLeave: () => void;
  /** Handle drop event. */
  handleDrop: (event: DragEvent) => void;
  /** Handle Tauri file drop hover. */
  handleTauriFileDropHover: (paths: string[]) => void;
  /** Handle Tauri file drop. */
  handleTauriFileDrop: (paths: string[]) => void;
}

/**
 * Composable for file input, drag & drop handling.
 */
export function useFileInput(options: UseFileInputOptions): UseFileInputReturn {
  const {
    activeTab,
    queueError,
    lastDroppedRoot,
    addManualJobMock,
    enqueueManualJobFromPath,
    pendingSmartScanAfterFolder,
    showSmartScan,
    t,
  } = options;

  // ----- State -----
  const isDragging = ref(false);
  const fileInputRef = ref<HTMLInputElement | null>(null);
  const folderInputRef = ref<HTMLInputElement | null>(null);

  // ----- Methods -----
  const handleFileInputChange = async (event: Event) => {
    const input = (event.target as HTMLInputElement | null) ?? fileInputRef.value;
    const file = input?.files?.[0];
    if (!file) return;

    const anyFile = file as any;
    const path: string | undefined = anyFile?.path;

    // In pure web mode, use mock behavior for usability.
    if (!hasTauri()) {
      addManualJobMock();
      if (input) {
        input.value = "";
      }
      return;
    }

    // In Tauri environment, if we can't get the local path, don't create a fake frontend job,
    // otherwise it will be immediately overwritten by backend polling.
    if (!path || typeof path !== "string") {
      console.error(
        "Selected file does not expose a native path in Tauri; cannot enqueue backend job from file input",
      );
      queueError.value = (t?.("queue.error.enqueueFailed") as string) ?? "";
      if (input) {
        input.value = "";
      }
      return;
    }

    await enqueueManualJobFromPath(path);

    if (input) {
      input.value = "";
    }
  };

  const handleFolderInputChange = (event: Event) => {
    const input = (event.target as HTMLInputElement | null) ?? folderInputRef.value;
    const files = input?.files;

    if (!files || files.length === 0) {
      if (input) {
        input.value = "";
      }
      if (pendingSmartScanAfterFolder) {
        pendingSmartScanAfterFolder.value = false;
      }
      return;
    }

    const first = files[0] as any;
    const rawPath: string | undefined = first?.path;

    if (hasTauri() && rawPath && typeof rawPath === "string") {
      const normalized = rawPath.replace(/\\/g, "/");
      const lastSlash = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
      lastDroppedRoot.value = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized;
    } else {
      console.error("Selected folder does not expose a native path; ignoring selection");
    }

    if (pendingSmartScanAfterFolder?.value && lastDroppedRoot.value && showSmartScan) {
      showSmartScan.value = true;
    }

    if (pendingSmartScanAfterFolder) {
      pendingSmartScanAfterFolder.value = false;
    }

    if (input) {
      input.value = "";
    }
  };

  const addManualJob = async () => {
    activeTab.value = "queue";

    // In pure web mode we keep the mock behaviour so the UI remains usable.
    if (!hasTauri()) {
      addManualJobMock();
      return;
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Video",
            extensions: EXTENSIONS.videos.map((ext) => ext.replace(/^\./, "")),
          },
        ],
      });

      if (!selected) {
        // User cancelled the dialog; do not treat as an error.
        return;
      }

      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path || typeof path !== "string") {
        console.error("Dialog returned an invalid path for manual job", selected);
        queueError.value = (t?.("queue.error.enqueueFailed") as string) ?? "";
        return;
      }

      await enqueueManualJobFromPath(path);
    } catch (error) {
      console.error("Failed to open dialog for manual job", error);
      queueError.value = (t?.("queue.error.enqueueFailed") as string) ?? "";
    }
  };

  const handlePathsDroppedOntoQueue = async (paths: string[]) => {
    const normalized = (paths || []).filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (normalized.length === 0) return;

    // Record the most recent dropped root directory for subsequent Smart Scan.
    const first = normalized[0].replace(/\\/g, "/");
    const lastSlash = first.lastIndexOf("/");
    lastDroppedRoot.value = lastSlash >= 0 ? first.slice(0, lastSlash) : first;

    // Pure web mode: keep existing "usable" mock behavior.
    if (!hasTauri()) {
      addManualJobMock();
      return;
    }

    // Only queue video extensions, discard others.
    const videoExts = EXTENSIONS.videos.map((ext) => ext.toLowerCase());
    const videoPaths = normalized.filter((p) => {
      const lower = p.toLowerCase();
      return videoExts.some((ext) => lower.endsWith(ext));
    });

    if (videoPaths.length === 0) {
      return;
    }

    for (const path of videoPaths) {
      // Enqueue sequentially to avoid race conditions.
      await enqueueManualJobFromPath(path);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    // Only show drag overlay on queue tab.
    if (activeTab.value === "queue") {
      isDragging.value = true;
    }
  };

  const handleDragLeave = () => {
    isDragging.value = false;
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    isDragging.value = false;

    // Real desktop app uses Tauri's onDragDropEvent for paths and lifecycle.
    // DOM drop is mainly for pure web preview environment.
    if (hasTauri() || activeTab.value !== "queue") {
      return;
    }

    const dt = event.dataTransfer;
    if (!dt?.files || dt.files.length === 0) return;

    const rawPaths: string[] = [];
    for (const file of Array.from(dt.files)) {
      const anyFile = file as any;
      if (anyFile?.path && typeof anyFile.path === "string") {
        rawPaths.push(anyFile.path);
      }
    }

    void handlePathsDroppedOntoQueue(rawPaths);
  };

  const handleTauriFileDropHover = (paths: string[]) => {
    if (activeTab.value !== "queue") return;
    // Only show the overlay when at least one dropped path looks like a media file.
    const lowerPaths = paths.map((p) => p.toLowerCase());
    const allExts = [...EXTENSIONS.videos, ...EXTENSIONS.images].map((ext) => ext.toLowerCase());
    const hasMedia = lowerPaths.some((p) => allExts.some((ext) => p.endsWith(ext)));
    if (hasMedia) {
      isDragging.value = true;
    }
  };

  const handleTauriFileDrop = (paths: string[]) => {
    isDragging.value = false;
    if (activeTab.value !== "queue" || !paths || paths.length === 0) return;

    void handlePathsDroppedOntoQueue(paths);
  };

  return {
    // State
    isDragging,
    fileInputRef,
    folderInputRef,

    // Methods
    handleFileInputChange,
    handleFolderInputChange,
    addManualJob,
    handlePathsDroppedOntoQueue,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleTauriFileDropHover,
    handleTauriFileDrop,
  };
}

export default useFileInput;
