import { watch, type Ref } from "vue";
import {
  ALL_QUEUE_SORT_DIRECTIONS,
  ALL_QUEUE_SORT_FIELDS,
  type QueueFilterKind,
  type QueueFilterStatus,
  type QueueSortDirection,
  type QueueSortField,
} from "./useQueueFiltering.types";

export interface QueueFilterSortStorageRefs {
  sortPrimary: Ref<QueueSortField>;
  sortPrimaryDirection: Ref<QueueSortDirection>;
  sortSecondary: Ref<QueueSortField>;
  sortSecondaryDirection: Ref<QueueSortDirection>;
  filterText: Ref<string>;
  filterUseRegex: Ref<boolean>;
  activeStatusFilters: Ref<Set<QueueFilterStatus>>;
  activeTypeFilters: Ref<Set<QueueFilterKind>>;
}

export function installQueueFilterSortStorage(refs: QueueFilterSortStorageRefs) {
  const QUEUE_SORT_PRIMARY_STORAGE_KEY = "ffui.queueSortPrimary";
  const QUEUE_SORT_PRIMARY_DIRECTION_STORAGE_KEY = "ffui.queueSortPrimaryDirection";
  const QUEUE_SORT_SECONDARY_STORAGE_KEY = "ffui.queueSortSecondary";
  const QUEUE_SORT_SECONDARY_DIRECTION_STORAGE_KEY = "ffui.queueSortSecondaryDirection";
  const QUEUE_FILTER_TEXT_STORAGE_KEY = "ffui.queueFilterText";
  const QUEUE_FILTER_USE_REGEX_STORAGE_KEY = "ffui.queueFilterUseRegex";
  const QUEUE_FILTER_STATUS_STORAGE_KEY = "ffui.queueFilterStatus";
  const QUEUE_FILTER_KIND_STORAGE_KEY = "ffui.queueFilterKind";

  const canUseStorage = () => {
    if (typeof window === "undefined") return false;
    try {
      return typeof window.localStorage !== "undefined";
    } catch {
      return false;
    }
  };

  const readFromStorage = (key: string): string | null => {
    if (!canUseStorage()) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return raw;
    } catch {
      return null;
    }
  };

  const writeToStorage = (key: string, value: string) => {
    if (!canUseStorage()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Swallow storage errors; preferences are a UX enhancement, not critical.
    }
  };

  const queueSortFields = new Set<string>(ALL_QUEUE_SORT_FIELDS);
  const isQueueSortField = (value: unknown): value is QueueSortField =>
    typeof value === "string" && queueSortFields.has(value);

  const queueSortDirections = new Set<string>(ALL_QUEUE_SORT_DIRECTIONS);
  const isQueueSortDirection = (value: unknown): value is QueueSortDirection =>
    typeof value === "string" && queueSortDirections.has(value);

  const queueFilterStatuses = new Set<string>([
    "queued",
    "processing",
    "paused",
    "completed",
    "failed",
    "skipped",
    "cancelled",
  ]);
  const isQueueFilterStatus = (value: unknown): value is QueueFilterStatus =>
    typeof value === "string" && queueFilterStatuses.has(value);

  const queueFilterKinds = new Set<string>(["manual", "batchCompress"]);
  const isQueueFilterKind = (value: unknown): value is QueueFilterKind =>
    typeof value === "string" && queueFilterKinds.has(value);

  const parseStoredJsonArray = (raw: string | null): unknown[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const storedSortPrimary = readFromStorage(QUEUE_SORT_PRIMARY_STORAGE_KEY);
  if (isQueueSortField(storedSortPrimary)) {
    refs.sortPrimary.value = storedSortPrimary;
  }

  const storedSortPrimaryDirection = readFromStorage(QUEUE_SORT_PRIMARY_DIRECTION_STORAGE_KEY);
  if (isQueueSortDirection(storedSortPrimaryDirection)) {
    refs.sortPrimaryDirection.value = storedSortPrimaryDirection;
  }

  const storedSortSecondary = readFromStorage(QUEUE_SORT_SECONDARY_STORAGE_KEY);
  if (isQueueSortField(storedSortSecondary)) {
    refs.sortSecondary.value = storedSortSecondary;
  }

  const storedSortSecondaryDirection = readFromStorage(QUEUE_SORT_SECONDARY_DIRECTION_STORAGE_KEY);
  if (isQueueSortDirection(storedSortSecondaryDirection)) {
    refs.sortSecondaryDirection.value = storedSortSecondaryDirection;
  }

  const storedFilterText = readFromStorage(QUEUE_FILTER_TEXT_STORAGE_KEY);
  if (typeof storedFilterText === "string") {
    refs.filterText.value = storedFilterText;
  }

  const storedFilterUseRegex = readFromStorage(QUEUE_FILTER_USE_REGEX_STORAGE_KEY);
  if (storedFilterUseRegex === "1") {
    refs.filterUseRegex.value = true;
  } else if (storedFilterUseRegex === "0") {
    refs.filterUseRegex.value = false;
  }

  const storedStatusFilters = parseStoredJsonArray(readFromStorage(QUEUE_FILTER_STATUS_STORAGE_KEY));
  const nextStatusFilters = storedStatusFilters.filter(isQueueFilterStatus);
  if (nextStatusFilters.length > 0) {
    refs.activeStatusFilters.value = new Set(nextStatusFilters);
  }

  const storedTypeFilters = parseStoredJsonArray(readFromStorage(QUEUE_FILTER_KIND_STORAGE_KEY));
  const nextTypeFilters = storedTypeFilters.filter(isQueueFilterKind);
  if (nextTypeFilters.length > 0) {
    refs.activeTypeFilters.value = new Set(nextTypeFilters);
  }

  watch(
    refs.sortPrimary,
    (value) => {
      writeToStorage(QUEUE_SORT_PRIMARY_STORAGE_KEY, value);
    },
    { flush: "sync" },
  );

  watch(
    refs.sortPrimaryDirection,
    (value) => {
      writeToStorage(QUEUE_SORT_PRIMARY_DIRECTION_STORAGE_KEY, value);
    },
    { flush: "sync" },
  );

  watch(
    refs.sortSecondary,
    (value) => {
      writeToStorage(QUEUE_SORT_SECONDARY_STORAGE_KEY, value);
    },
    { flush: "sync" },
  );

  watch(
    refs.sortSecondaryDirection,
    (value) => {
      writeToStorage(QUEUE_SORT_SECONDARY_DIRECTION_STORAGE_KEY, value);
    },
    { flush: "sync" },
  );

  watch(
    refs.filterText,
    (value) => {
      writeToStorage(QUEUE_FILTER_TEXT_STORAGE_KEY, value);
    },
    { flush: "sync" },
  );

  watch(
    refs.filterUseRegex,
    (value) => {
      writeToStorage(QUEUE_FILTER_USE_REGEX_STORAGE_KEY, value ? "1" : "0");
    },
    { flush: "sync" },
  );

  watch(
    refs.activeStatusFilters,
    (value) => {
      writeToStorage(QUEUE_FILTER_STATUS_STORAGE_KEY, JSON.stringify(Array.from(value)));
    },
    { flush: "sync" },
  );

  watch(
    refs.activeTypeFilters,
    (value) => {
      writeToStorage(QUEUE_FILTER_KIND_STORAGE_KEY, JSON.stringify(Array.from(value)));
    },
    { flush: "sync" },
  );
}
