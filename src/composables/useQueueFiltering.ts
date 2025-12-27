import { computed, ref, watch } from "vue";
import type { TranscodeJob, CompositeBatchCompressTask } from "@/types";
import { matchesSizeFilter, parseSizeFilterToken, type SizeFilter } from "./queue/sizeFilter";
import { createSelectionHelpers } from "./queue/selection";
import {
  type QueueFilterKind,
  type QueueFilterStatus,
  type QueueSortDirection,
  type QueueSortField,
  type UseQueueFilteringOptions,
  type UseQueueFilteringReturn,
} from "./queue/useQueueFiltering.types";
import { createQueueSortingState, type QueueSortingState } from "./queue/queueSorting";
import { installQueueFilterSortStorage } from "./queue/queueFilterSortStorage";

/**
 * Composable for queue filtering, sorting, and selection.
 */
export function useQueueFiltering(options: UseQueueFilteringOptions): UseQueueFilteringReturn {
  const { jobs, queueStructureRevision, queueProgressRevision, t } = options;

  // ----- State -----
  const selectedJobIds = ref<Set<string>>(new Set());
  const activeStatusFilters = ref<Set<QueueFilterStatus>>(new Set());
  const activeTypeFilters = ref<Set<QueueFilterKind>>(new Set());
  const filterText = ref("");
  const filterUseRegex = ref(false);
  const filterRegexError = ref<string | null>(null);
  const filterRegex = ref<RegExp | null>(null);
  let lastValidFilterRegex: RegExp | null = null;

  const sortPrimary = ref<QueueSortField>("addedTime");
  const sortPrimaryDirection = ref<QueueSortDirection>("asc");
  const sortSecondary = ref<QueueSortField>("filename");
  const sortSecondaryDirection = ref<QueueSortDirection>("asc");

  installQueueFilterSortStorage({
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,
    filterText,
    filterUseRegex,
    activeStatusFilters,
    activeTypeFilters,
  });

  // ----- Regex Validation Watch -----
  // Supports two modes:
  // 1) Global regex mode (filterUseRegex === true): treat the entire input as a
  //    single regex pattern.
  // 2) Token mode (filterUseRegex === false): look for a token with the prefix
  //    "regex:" and compile only the suffix as a regex. This is used by the
  //    unified text filter syntax like: `building size>20mb regex:.*building.*`.
  watch(
    [filterText, filterUseRegex],
    ([pattern, useRegex]) => {
      const text = (pattern ?? "").trim();
      if (!text) {
        filterRegex.value = null;
        filterRegexError.value = null;
        lastValidFilterRegex = null;
        return;
      }

      let candidate: string | null = null;

      if (useRegex) {
        candidate = text;
      } else {
        const regexToken = filterTextTokens.value.find((token) => token.toLowerCase().startsWith("regex:"));
        if (!regexToken) {
          // No regex token in unified query mode; clear regex state.
          filterRegex.value = null;
          filterRegexError.value = null;
          lastValidFilterRegex = null;
          return;
        }
        candidate = regexToken.slice("regex:".length);
      }

      const candidateText = (candidate ?? "").trim();
      if (!candidateText) {
        filterRegex.value = null;
        filterRegexError.value = null;
        lastValidFilterRegex = null;
        return;
      }

      try {
        const rx = new RegExp(candidateText, "i");
        filterRegex.value = rx;
        filterRegexError.value = null;
        lastValidFilterRegex = rx;
      } catch {
        filterRegexError.value = t?.("queue.filters.invalidRegex") ?? "";
        // Keep using the last valid regex (if any) so the UI remains stable.
        filterRegex.value = lastValidFilterRegex;
      }
    },
    { flush: "sync" },
  );

  // ----- Computed -----
  const hasActiveFilters = computed(() => {
    if (activeStatusFilters.value.size > 0) return true;
    if (activeTypeFilters.value.size > 0) return true;
    const text = filterText.value.trim();
    if (!text) return false;
    return true;
  });

  const hasSelection = computed(() => selectedJobIds.value.size > 0);

  const selectedJobs = computed<TranscodeJob[]>(() => {
    const byId = new Map(jobs.value.map((job) => [job.id, job]));
    const result: TranscodeJob[] = [];
    for (const id of selectedJobIds.value) {
      const job = byId.get(id);
      if (job) result.push(job);
    }
    return result;
  });

  type ParsedTextFilterCriteria =
    | {
        mode: "none";
        rawText: "";
        plainTokensLower: string[];
        sizeFilter: SizeFilter | null;
      }
    | {
        mode: "regex";
        rawText: string;
        plainTokensLower: string[];
        sizeFilter: SizeFilter | null;
      }
    | {
        mode: "tokens";
        rawText: string;
        plainTokensLower: string[];
        sizeFilter: SizeFilter | null;
      };

  const filterTextTokens = computed<string[]>(() => {
    const text = filterText.value.trim();
    if (!text) return [];
    return text
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  });

  const parsedTextCriteria = computed<ParsedTextFilterCriteria>(() => {
    const rawText = filterText.value.trim();
    if (!rawText) {
      return { mode: "none", rawText: "", plainTokensLower: [], sizeFilter: null };
    }

    if (filterUseRegex.value) {
      return { mode: "regex", rawText, plainTokensLower: [], sizeFilter: null };
    }

    let sizeFilter: SizeFilter | null = null;
    const plainTokensLower: string[] = [];

    for (const token of filterTextTokens.value) {
      if (token === "/") {
        // Treat a bare "/" token (for example from "a size>10 / regex:...")
        // as a visual separator, not a filter term.
        continue;
      }

      // Regex tokens are handled by the watcher and exposed via filterRegex.
      if (token.toLowerCase().startsWith("regex:")) {
        continue;
      }

      const parsed = parseSizeFilterToken(token);
      if (parsed) {
        sizeFilter = parsed;
        continue;
      }

      const needle = token.toLowerCase();
      if (needle) {
        plainTokensLower.push(needle);
      }
    }

    return { mode: "tokens", rawText, plainTokensLower, sizeFilter };
  });

  // ----- Filter Methods -----
  const jobMatchesFiltersInternal = (job: TranscodeJob, options?: { ignoreStatusFilters?: boolean }): boolean => {
    if (!options?.ignoreStatusFilters && activeStatusFilters.value.size > 0) {
      if (!activeStatusFilters.value.has(job.status as QueueFilterStatus)) {
        return false;
      }
    }

    if (activeTypeFilters.value.size > 0) {
      const kind: QueueFilterKind = job.source === "batch_compress" ? "batchCompress" : "manual";
      if (!activeTypeFilters.value.has(kind)) {
        return false;
      }
    }

    const criteria = parsedTextCriteria.value;
    if (criteria.mode === "none") {
      return true;
    }

    const haystack = (job.inputPath || job.filename || "").toLowerCase();
    if (!haystack) return false;

    // Global regex mode: entire input is treated as a single regex pattern.
    if (criteria.mode === "regex") {
      const rx = filterRegex.value;
      if (!rx) {
        // When the regex is invalid and no previous valid regex exists, keep
        // the list stable instead of dropping all rows.
        return true;
      }
      return rx.test(haystack);
    }

    // Unified text filter mode with support for:
    // - plain text tokens (substring match)
    // - size tokens like "size>10mb"
    // - an optional regex token "regex:pattern"
    // Plain-text token matching: each token must be present in the haystack
    // (logical AND across tokens).
    for (const needle of criteria.plainTokensLower) {
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    // Regex token in unified mode: when present, it is AND-ed with the plain
    // tokens and size filter.
    if (filterRegex.value) {
      const rx = filterRegex.value;
      if (rx && !rx.test(haystack)) {
        return false;
      }
    }

    if (!criteria.sizeFilter) {
      return true;
    }

    return matchesSizeFilter(job, criteria.sizeFilter);
  };

  const jobMatchesFilters = (job: TranscodeJob): boolean => jobMatchesFiltersInternal(job);

  const batchMatchesFilters = (batch: CompositeBatchCompressTask): boolean => {
    // When no filters are active, include batches that still have visible jobs.
    if (!hasActiveFilters.value) {
      return true;
    }

    // If any child job matches the current filters, surface the batch.
    if (batch.jobs.some((job) => jobMatchesFilters(job))) {
      return true;
    }

    // Fall back to rootPath text matching so users can filter by directory.
    const text = filterText.value.trim();
    if (!text) return false;

    const root = (batch.rootPath || "").toLowerCase();
    if (!root) return false;

    if (filterUseRegex.value) {
      const rx = filterRegex.value;
      if (!rx) return false;
      return rx.test(root);
    }

    return root.includes(text.toLowerCase());
  };

  const filteredJobs = computed<TranscodeJob[]>(() => {
    return jobs.value.filter((job) => jobMatchesFilters(job));
  });

  // Queue mode should always surface actively processing jobs so users can
  // monitor what's running, even if status filters are set to focus on waiting
  // items. We still respect type/text filters so the list can be narrowed
  // intentionally.
  const filteredJobsIgnoringStatus = computed<TranscodeJob[]>(() => {
    return jobs.value.filter((job) => jobMatchesFiltersInternal(job, { ignoreStatusFilters: true }));
  });

  // ----- Sorting & grouping -----
  const {
    hasPrimarySortTies,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
    compareJobsInWaitingGroup,
  }: QueueSortingState = createQueueSortingState({
    filteredJobs,
    filteredJobsIgnoringStatus,
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,
    queueStructureRevision,
    queueProgressRevision,
  });

  const { isJobSelected, toggleJobSelected, clearSelection, selectAllVisibleJobs, invertSelection } =
    createSelectionHelpers(selectedJobIds, filteredJobs);

  // ----- Filter Toggle Methods -----
  const toggleStatusFilter = (status: QueueFilterStatus) => {
    const next = new Set(activeStatusFilters.value);
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    activeStatusFilters.value = next;
  };

  const toggleTypeFilter = (kind: QueueFilterKind) => {
    const next = new Set(activeTypeFilters.value);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    activeTypeFilters.value = next;
  };

  const resetQueueFilters = () => {
    activeStatusFilters.value = new Set();
    activeTypeFilters.value = new Set();
    filterText.value = "";
    filterUseRegex.value = false;
    filterRegexError.value = null;
    filterRegex.value = null;
    lastValidFilterRegex = null;
  };

  const toggleFilterRegexMode = () => {
    filterUseRegex.value = !filterUseRegex.value;
  };

  return {
    // State
    selectedJobIds,
    activeStatusFilters,
    activeTypeFilters,
    filterText,
    filterUseRegex,
    filterRegexError,
    filterRegex,
    sortPrimary,
    sortPrimaryDirection,
    sortSecondary,
    sortSecondaryDirection,

    // Computed
    hasActiveFilters,
    hasSelection,
    hasPrimarySortTies,
    selectedJobs,
    filteredJobs,
    displayModeSortedJobs,
    manualQueueJobs,
    queueModeProcessingJobs,
    queueModeWaitingJobs,

    // Methods
    jobMatchesFilters,
    batchMatchesFilters,
    isJobSelected,
    toggleJobSelected,
    clearSelection,
    selectAllVisibleJobs,
    invertSelection,
    toggleStatusFilter,
    toggleTypeFilter,
    resetQueueFilters,
    toggleFilterRegexMode,
    compareJobsByConfiguredFields,
    compareJobsForDisplay,
    compareJobsInWaitingGroup,
  };
}

export default useQueueFiltering;
