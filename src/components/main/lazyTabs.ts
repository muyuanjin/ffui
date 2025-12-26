import { defineAsyncComponent, defineComponent, h } from "vue";
import { useI18n } from "vue-i18n";

export const LazyTabLoading = defineComponent({
  name: "LazyTabLoading",
  setup() {
    const { t } = useI18n();
    return () =>
      h(
        "div",
        { class: "flex flex-1 min-h-0 items-center justify-center text-sm text-muted-foreground" },
        t("common.loading"),
      );
  },
});

export const LazyTabError = defineComponent({
  name: "LazyTabError",
  setup() {
    return () =>
      h("div", { class: "flex flex-1 min-h-0 items-center justify-center text-sm text-destructive" }, "模块加载失败");
  },
});

export const MediaPanel = defineAsyncComponent({
  loader: () => import("@/components/panels/MediaPanel.vue"),
  loadingComponent: LazyTabLoading,
  errorComponent: LazyTabError,
  delay: 120,
  timeout: 30_000,
});

export const MonitorPanelPro = defineAsyncComponent({
  loader: () => import("@/components/panels/MonitorPanelPro.vue"),
  loadingComponent: LazyTabLoading,
  errorComponent: LazyTabError,
  delay: 120,
  timeout: 30_000,
});

export const SettingsPanel = defineAsyncComponent({
  loader: () => import("@/components/panels/SettingsPanel.vue"),
  loadingComponent: LazyTabLoading,
  errorComponent: LazyTabError,
  delay: 120,
  timeout: 30_000,
});
