import { ref, type Ref } from "vue";
import type { QueueMode, QueueProgressStyle, QueueViewMode } from "@/types";

/**
 * Storage keys for queue view preferences.
 */
export const QUEUE_VIEW_MODE_STORAGE_KEY = "ffui.queueViewMode";
export const QUEUE_PROGRESS_STYLE_STORAGE_KEY = "ffui.queueProgressStyle";
export const QUEUE_MODE_STORAGE_KEY = "ffui.queueMode";

const DEFAULT_VIEW_MODE: QueueViewMode = "detail";
const DEFAULT_PROGRESS_STYLE: QueueProgressStyle = "bar";
const DEFAULT_QUEUE_MODE: QueueMode = "display";

const ALL_VIEW_MODES: QueueViewMode[] = [
  "compact",
  "detail",
  "icon-small",
  "icon-medium",
  "icon-large",
  "dynamic-card",
];

const ALL_PROGRESS_STYLES: QueueProgressStyle[] = ["bar", "card-fill", "ripple-card"];

const ALL_QUEUE_MODES: QueueMode[] = ["display", "queue"];

const queueViewMode: Ref<QueueViewMode> = ref(DEFAULT_VIEW_MODE);
const queueProgressStyle: Ref<QueueProgressStyle> = ref(DEFAULT_PROGRESS_STYLE);
const queueMode: Ref<QueueMode> = ref(DEFAULT_QUEUE_MODE);

let initialized = false;

const isQueueViewMode = (value: unknown): value is QueueViewMode => {
  return typeof value === "string" && (ALL_VIEW_MODES as string[]).includes(value);
};

const isQueueProgressStyle = (value: unknown): value is QueueProgressStyle => {
  return typeof value === "string" && (ALL_PROGRESS_STYLES as string[]).includes(value);
};

const isQueueMode = (value: unknown): value is QueueMode => {
  return typeof value === "string" && (ALL_QUEUE_MODES as string[]).includes(value);
};

const canUseStorage = () => {
  if (typeof window === "undefined") return false;
  try {
    const anyWindow = window as any;
    return typeof anyWindow.localStorage !== "undefined";
  } catch {
    return false;
  }
};

const readFromStorage = <T>(key: string, validate: (value: unknown) => value is T): T | null => {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (validate(raw)) return raw;
    return null;
  } catch {
    return null;
  }
};

const writeToStorage = <T>(key: string, value: T) => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Swallow storage errors; preferences are a UX enhancement, not critical.
  }
};

const ensureInitialized = () => {
  if (initialized) return;

  const storedViewMode = readFromStorage<QueueViewMode>(QUEUE_VIEW_MODE_STORAGE_KEY, isQueueViewMode);
  const storedProgressStyle = readFromStorage<QueueProgressStyle>(
    QUEUE_PROGRESS_STYLE_STORAGE_KEY,
    isQueueProgressStyle,
  );

  const storedQueueMode = readFromStorage<QueueMode>(QUEUE_MODE_STORAGE_KEY, isQueueMode);

  if (storedViewMode) {
    queueViewMode.value = storedViewMode;
  } else {
    queueViewMode.value = DEFAULT_VIEW_MODE;
  }

  if (storedProgressStyle) {
    queueProgressStyle.value = storedProgressStyle;
  } else {
    queueProgressStyle.value = DEFAULT_PROGRESS_STYLE;
  }

  if (storedQueueMode) {
    queueMode.value = storedQueueMode;
  } else {
    queueMode.value = DEFAULT_QUEUE_MODE;
  }

  initialized = true;
};

export const useQueuePreferences = () => {
  ensureInitialized();

  const setQueueViewMode = (mode: QueueViewMode) => {
    if (!isQueueViewMode(mode)) return;
    queueViewMode.value = mode;
    writeToStorage(QUEUE_VIEW_MODE_STORAGE_KEY, mode);
  };

  const setQueueProgressStyle = (style: QueueProgressStyle) => {
    if (!isQueueProgressStyle(style)) return;
    queueProgressStyle.value = style;
    writeToStorage(QUEUE_PROGRESS_STYLE_STORAGE_KEY, style);
  };

  const setQueueMode = (mode: QueueMode) => {
    if (!isQueueMode(mode)) return;
    queueMode.value = mode;
    writeToStorage(QUEUE_MODE_STORAGE_KEY, mode);
  };

  return {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
    availableViewModes: ALL_VIEW_MODES as readonly QueueViewMode[],
    availableProgressStyles: ALL_PROGRESS_STYLES as readonly QueueProgressStyle[],
    availableQueueModes: ALL_QUEUE_MODES as readonly QueueMode[],
    defaults: {
      viewMode: DEFAULT_VIEW_MODE,
      progressStyle: DEFAULT_PROGRESS_STYLE,
      mode: DEFAULT_QUEUE_MODE,
    },
  };
};
