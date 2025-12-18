import { ref, type Ref } from "vue";
import type { QueueMode, QueueProgressStyle, QueueViewMode } from "@/types";

/**
 * Storage keys for queue view preferences.
 */
export const QUEUE_VIEW_MODE_STORAGE_KEY = "ffui.queueViewMode";
export const QUEUE_PROGRESS_STYLE_STORAGE_KEY = "ffui.queueProgressStyle";
export const QUEUE_MODE_STORAGE_KEY = "ffui.queueMode";
export const CAROUSEL_AUTO_ROTATION_SPEED_STORAGE_KEY = "ffui.carouselAutoRotationSpeed";

const DEFAULT_VIEW_MODE: QueueViewMode = "detail";
const DEFAULT_PROGRESS_STYLE: QueueProgressStyle = "bar";
const DEFAULT_QUEUE_MODE: QueueMode = "display";
const DEFAULT_CAROUSEL_AUTO_ROTATION_SPEED = 0;

const ALL_VIEW_MODES: QueueViewMode[] = [
  "compact",
  "detail",
  "icon-small",
  "icon-medium",
  "icon-large",
  "dynamic-card",
  "carousel-3d",
];

const ALL_PROGRESS_STYLES: QueueProgressStyle[] = ["bar", "card-fill", "ripple-card"];

const ALL_QUEUE_MODES: QueueMode[] = ["display", "queue"];

const queueViewMode: Ref<QueueViewMode> = ref(DEFAULT_VIEW_MODE);
const queueProgressStyle: Ref<QueueProgressStyle> = ref(DEFAULT_PROGRESS_STYLE);
const queueMode: Ref<QueueMode> = ref(DEFAULT_QUEUE_MODE);
const carouselAutoRotationSpeed: Ref<number> = ref(DEFAULT_CAROUSEL_AUTO_ROTATION_SPEED);

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

const isValidCarouselSpeed = (value: unknown): value is number => {
  if (typeof value !== "number") return false;
  return value >= 0 && value <= 10;
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

const readNumberFromStorage = (key: string, validate: (value: number) => boolean): number | null => {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const num = Number(raw);
    if (Number.isNaN(num)) return null;
    if (validate(num)) return num;
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
  const storedCarouselSpeed = readNumberFromStorage(CAROUSEL_AUTO_ROTATION_SPEED_STORAGE_KEY, (v) => v >= 0 && v <= 10);

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

  if (storedCarouselSpeed !== null) {
    carouselAutoRotationSpeed.value = storedCarouselSpeed;
  } else {
    carouselAutoRotationSpeed.value = DEFAULT_CAROUSEL_AUTO_ROTATION_SPEED;
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

  const setCarouselAutoRotationSpeed = (speed: number) => {
    if (!isValidCarouselSpeed(speed)) return;
    carouselAutoRotationSpeed.value = speed;
    writeToStorage(CAROUSEL_AUTO_ROTATION_SPEED_STORAGE_KEY, speed);
  };

  return {
    queueViewMode,
    queueProgressStyle,
    queueMode,
    carouselAutoRotationSpeed,
    setQueueViewMode,
    setQueueProgressStyle,
    setQueueMode,
    setCarouselAutoRotationSpeed,
    availableViewModes: ALL_VIEW_MODES as readonly QueueViewMode[],
    availableProgressStyles: ALL_PROGRESS_STYLES as readonly QueueProgressStyle[],
    availableQueueModes: ALL_QUEUE_MODES as readonly QueueMode[],
    defaults: {
      viewMode: DEFAULT_VIEW_MODE,
      progressStyle: DEFAULT_PROGRESS_STYLE,
      mode: DEFAULT_QUEUE_MODE,
      carouselAutoRotationSpeed: DEFAULT_CAROUSEL_AUTO_ROTATION_SPEED,
    },
  };
};
