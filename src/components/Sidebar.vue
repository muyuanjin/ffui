<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";
import { computed, type Component } from "vue";
import { Activity, Film, ListTodo, Settings2, SlidersHorizontal } from "lucide-vue-next";

const { activeTab, jobs } = defineProps<{
  /** Current active tab */
  activeTab: "queue" | "presets" | "media" | "monitor" | "settings";
  /** List of all jobs (for processing indicator) */
  jobs: TranscodeJob[];
  /** Whether an app update is currently available. */
  appUpdateAvailable?: boolean;
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: "queue" | "presets" | "media" | "monitor" | "settings"];
  addJobFiles: [];
  addJobFolder: [];
  smartScan: [];
}>();

const { t } = useI18n();

type ActiveTab = "queue" | "presets" | "media" | "monitor" | "settings";
type TabMeta = {
  titleKey: string;
  hintKey: string;
  Icon: Component;
};

const tabMetaByKey: Record<ActiveTab, TabMeta> = {
  queue: { titleKey: "app.tabs.queue", hintKey: "app.queueHint", Icon: ListTodo },
  presets: {
    titleKey: "app.tabs.presets",
    hintKey: "app.presetsHint",
    Icon: SlidersHorizontal,
  },
  media: { titleKey: "app.tabs.media", hintKey: "app.mediaHint", Icon: Film },
  monitor: { titleKey: "app.tabs.monitor", hintKey: "app.monitorHint", Icon: Activity },
  settings: { titleKey: "app.tabs.settings", hintKey: "app.settingsHint", Icon: Settings2 },
};

const activeMeta = computed(() => tabMetaByKey[activeTab]);
const processingCount = computed(
  () => jobs.filter((j) => j.status === "processing").length,
);

const setActiveTab = (tab: "queue" | "presets" | "media" | "monitor" | "settings") => {
  emit("update:activeTab", tab);
};
</script>

<template>
  <aside class="w-64 bg-sidebar border-r border-sidebar-border flex flex-col" data-testid="ffui-sidebar">
    <div class="shrink-0 border-b border-sidebar-border">
      <div class="px-5 py-4">
        <div class="flex items-start gap-3">
          <div class="h-10 w-10 rounded-lg flex items-center justify-center overflow-hidden">
            <img src="/ffui.svg" alt="FFUI" class="h-10 w-10" />
          </div>
          <div class="min-w-0 flex-1">
            <div
              class="text-[11px] font-semibold tracking-wide text-sidebar-foreground/70"
              data-testid="ffui-sidebar-title"
            >
              {{ t("app.sidebarTitle") }}
            </div>
            <div
              class="mt-2 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/30 px-3 py-2 h-[58px] flex items-center gap-2 overflow-hidden"
              data-testid="ffui-sidebar-active-info"
            >
              <component
                :is="activeMeta.Icon"
                class="h-4 w-4 shrink-0 text-sidebar-primary"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <div
                  class="text-sm font-semibold text-sidebar-foreground leading-5 truncate"
                  data-testid="ffui-sidebar-active-title"
                  :title="t(activeMeta.titleKey)"
                >
                  {{ t(activeMeta.titleKey) }}
                </div>
                <div
                  class="text-xs text-sidebar-foreground/75 leading-4 max-h-8 overflow-hidden"
                  data-testid="ffui-sidebar-active-hint"
                  :title="t(activeMeta.hintKey)"
                >
                  {{ t(activeMeta.hintKey) }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <nav class="flex-1 px-3 py-4 space-y-2">
      <Button
        data-testid="ffui-tab-queue"
        variant="ghost"
        class="w-full justify-start px-3 h-11 rounded-lg text-sm font-medium relative overflow-hidden"
        :class="
          activeTab === 'queue'
            ? 'bg-sidebar-accent/85 text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-1 before:rounded-r before:bg-sidebar-primary'
            : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
        "
        @click="setActiveTab('queue')"
      >
        <span class="flex items-center gap-3 min-w-0">
          <ListTodo class="h-4 w-4 shrink-0 opacity-90" aria-hidden="true" />
          <span class="truncate">{{ t("app.tabs.queue") }}</span>
        </span>
        <span
          v-if="processingCount > 0"
          class="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
        />
      </Button>
      <Button
        data-testid="ffui-tab-presets"
        variant="ghost"
        class="w-full justify-start px-3 h-11 rounded-lg text-sm font-medium relative overflow-hidden"
        :class="
          activeTab === 'presets'
            ? 'bg-sidebar-accent/85 text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-1 before:rounded-r before:bg-sidebar-primary'
            : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
        "
        @click="setActiveTab('presets')"
      >
        <span class="flex items-center gap-3 min-w-0">
          <SlidersHorizontal class="h-4 w-4 shrink-0 opacity-90" aria-hidden="true" />
          <span class="truncate">{{ t("app.tabs.presets") }}</span>
        </span>
      </Button>
      <Button
        data-testid="ffui-tab-media"
        variant="ghost"
        class="w-full justify-start px-3 h-11 rounded-lg text-sm font-medium relative overflow-hidden"
        :class="
          activeTab === 'media'
            ? 'bg-sidebar-accent/85 text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-1 before:rounded-r before:bg-sidebar-primary'
            : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
        "
        @click="setActiveTab('media')"
      >
        <span class="flex items-center gap-3 min-w-0">
          <Film class="h-4 w-4 shrink-0 opacity-90" aria-hidden="true" />
          <span class="truncate">{{ t("app.tabs.media") }}</span>
        </span>
      </Button>
      <Button
        data-testid="ffui-tab-monitor"
        variant="ghost"
        class="w-full justify-start px-3 h-11 rounded-lg text-sm font-medium relative overflow-hidden"
        :class="
          activeTab === 'monitor'
            ? 'bg-sidebar-accent/85 text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-1 before:rounded-r before:bg-sidebar-primary'
            : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
        "
        @click="setActiveTab('monitor')"
      >
        <span class="flex items-center gap-3 min-w-0">
          <Activity class="h-4 w-4 shrink-0 opacity-90" aria-hidden="true" />
          <span class="truncate">{{ t("app.tabs.monitor") }}</span>
        </span>
      </Button>
      <Button
        data-testid="ffui-tab-settings"
        variant="ghost"
        class="w-full justify-start px-3 h-11 rounded-lg text-sm font-medium relative overflow-hidden"
        :class="
          activeTab === 'settings'
            ? 'bg-sidebar-accent/85 text-sidebar-foreground font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-1 before:rounded-r before:bg-sidebar-primary'
            : 'text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground'
        "
        @click="setActiveTab('settings')"
      >
        <span class="flex items-center gap-3 min-w-0">
          <Settings2 class="h-4 w-4 shrink-0 opacity-90" aria-hidden="true" />
          <span class="truncate">{{ t("app.tabs.settings") }}</span>
        </span>
        <span
          v-if="appUpdateAvailable"
          class="ml-auto w-2 h-2 rounded-full bg-sky-400 animate-pulse"
          aria-label="Update available"
          title="Update available"
        />
      </Button>
    </nav>

    <div class="shrink-0 px-4 py-4 border-t border-sidebar-border space-y-3">
      <div
        class="relative grid w-full grid-cols-2 overflow-hidden rounded-md after:absolute after:inset-y-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-white/35"
        data-testid="ffui-action-add-job-split"
      >
        <Button
          data-testid="ffui-action-add-job-files"
          variant="default"
          size="lg"
          class="justify-center rounded-none font-semibold text-white"
          @click="emit('addJobFiles')"
        >
          <span>{{ t("app.actions.addJobFiles") }}</span>
        </Button>
        <Button
          data-testid="ffui-action-add-job-folder"
          variant="manualFolder"
          size="lg"
          class="justify-center rounded-none font-semibold text-white"
          @click="emit('addJobFolder')"
        >
          <span class="whitespace-nowrap">{{ t("app.actions.addJobFolder") }}</span>
        </Button>
      </div>
      <Button
        data-testid="ffui-action-smart-scan"
        variant="smartScan"
        size="lg"
        class="w-full justify-center font-semibold text-white"
        @click="emit('smartScan')"
      >
        <span>{{ t("app.actions.smartScan") }}</span>
      </Button>
    </div>
  </aside>
</template>
