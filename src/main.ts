import { createApp } from "vue";
import App from "./App.vue";
import "./index.css";
import { i18n } from "./i18n";
import VueApexCharts from "vue3-apexcharts";

// Force dark theme to match design
document.documentElement.classList.add("dark");

const mountStartMark = "app_mount_start";
const mountEndMark = "app_mount_end";
const mountMeasureName = "app_mount_duration";

if (typeof performance !== "undefined" && "mark" in performance) {
  performance.mark(mountStartMark);
}

const app = createApp(App);
app.use(i18n);
app.use(VueApexCharts);
app.mount("#app");

if (
  typeof performance !== "undefined" &&
  "mark" in performance &&
  "measure" in performance &&
  "getEntriesByName" in performance
) {
  performance.mark(mountEndMark);
  performance.measure(mountMeasureName, mountStartMark, mountEndMark);
  const entries = performance.getEntriesByName(mountMeasureName);
  const last = entries[entries.length - 1];
  if (last && typeof console !== "undefined" && typeof console.log === "function") {
    // Rough startup metric from JS execution + initial Vue mount to help tune blank-window time.
    console.log(`[perf] Vue app mount: ${last.duration.toFixed(1)}ms`);
  }
}
