import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import { i18n, loadLocale } from "./i18n";
import VueApexCharts from "vue3-apexcharts";
import { hasTauri, loadAppSettings, saveAppSettings } from "@/lib/backend";
import { bootstrapAppLocale } from "@/lib/bootstrapAppLocale";

// Force dark theme to match design
document.documentElement.classList.add("dark");

const mountStartMark = "app_mount_start";
const mountEndMark = "app_mount_end";
const mountMeasureName = "app_mount_duration";

if (typeof performance !== "undefined" && "mark" in performance) {
  performance.mark(mountStartMark);
}

const bootstrapLocale = async () => {
  try {
    const result = await bootstrapAppLocale({
      hasTauri: hasTauri(),
      loadAppSettings,
      saveAppSettings,
    });
    loadLocale(result.locale);

    if (typeof window !== "undefined" && result.preloadedAppSettings) {
      window.__FFUI_PRELOADED_APP_SETTINGS__ = result.preloadedAppSettings;
    }
  } catch {
    // Best-effort only; fallback locale remains in effect.
  }
};

const run = async () => {
  await bootstrapLocale();

  const app = createApp(App);
  app.use(i18n);
  app.use(VueApexCharts);
  app.mount("#app");

  // Once the Vue shell has mounted, hand drag regions over to the in-app
  // TitleBar instead of the temporary global drag region defined on <body>
  // in index.html. This keeps the boot shell draggable during startup
  // without making the entire app surface draggable afterwards.
  if (typeof document !== "undefined" && document.body) {
    document.body.removeAttribute("data-tauri-drag-region");
  }

  if (
    typeof performance !== "undefined" &&
    "mark" in performance &&
    "measure" in performance &&
    "getEntriesByName" in performance &&
    "getEntriesByType" in performance
  ) {
    performance.mark(mountEndMark);
    performance.measure(mountMeasureName, mountStartMark, mountEndMark);
    const entries = performance.getEntriesByName(mountMeasureName);
    const last = entries[entries.length - 1];

    if (last) {
      let navToMountMs: number | null = null;

      try {
        const navEntries = performance.getEntriesByType("navigation") as PerformanceEntry[];
        if (navEntries.length > 0) {
          const nav = navEntries[0] as PerformanceEntry & { startTime: number };
          // Approximate time from navigation start to Vue app mounted.
          navToMountMs = last.startTime + last.duration - nav.startTime;
        }
      } catch {
        // Best-effort only; if the environment does not support navigation
        // entries we simply skip the extended metric.
        navToMountMs = null;
      }

      // Expose a small structured snapshot for ad‑hoc inspection in DevTools
      // without introducing any persistent storage or backend coupling.
      if (typeof window !== "undefined") {
        window.__FFUI_STARTUP_METRICS__ = {
          appMountMs: last.duration,
          navToMountMs,
        };
      }

      if (typeof console !== "undefined" && typeof console.log === "function") {
        const parts = [
          `[perf] Vue app mount: ${last.duration.toFixed(1)}ms`,
          navToMountMs != null ? `navigation→mount: ${navToMountMs.toFixed(1)}ms` : null,
        ].filter(Boolean);
        console.log(parts.join(" | "));
      }

      if (typeof window !== "undefined") {
        // Expose a helper to dump startup metrics and performance marks for
        // copy/paste diagnostics in release builds.
        window.__FFUI_DUMP_STARTUP_METRICS__ = () => {
          const metrics = window.__FFUI_STARTUP_METRICS__ ?? {};
          const markNames = [
            "startup_idle_ready",
            "first_queue_state_lite_applied",
            "app_settings_loaded",
            "tool_statuses_loaded",
            "tools_refresh_requested",
            "tools_refresh_received",
            "presets_loaded",
          ];
          const marks: Record<string, number | null> = {};
          if (typeof performance !== "undefined" && "getEntriesByName" in performance) {
            for (const name of markNames) {
              const entries = performance.getEntriesByName(name);
              const lastEntry = entries[entries.length - 1];
              marks[name] = lastEntry ? lastEntry.startTime : null;
            }
          } else {
            for (const name of markNames) {
              marks[name] = null;
            }
          }

          const payload = { metrics, marks };
          console.log("[startup] FFUI startup metrics:", payload);
          return payload;
        };

        // Avoid hard-coded delayed work in production builds; keep the helper
        // opt-in unless explicitly enabled.
        const shouldAutoDump =
          typeof import.meta !== "undefined" &&
          typeof import.meta.env !== "undefined" &&
          (import.meta.env.DEV || import.meta.env.VITE_AUTO_DUMP_STARTUP_METRICS === "1");

        if (shouldAutoDump) {
          window.setTimeout(() => {
            try {
              window.__FFUI_DUMP_STARTUP_METRICS__?.();
            } catch {
              // Best-effort only.
            }
          }, 1000);
        }
      }
    }
  }
};

void run();
