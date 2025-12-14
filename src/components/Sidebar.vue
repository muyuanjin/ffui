<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";

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

const setActiveTab = (tab: "queue" | "presets" | "media" | "monitor" | "settings") => {
  emit("update:activeTab", tab);
};
</script>

<template>
  <aside class="w-64 bg-sidebar border-r border-sidebar-border flex flex-col" data-testid="ffui-sidebar">
    <div class="shrink-0 px-5 py-4 border-b border-sidebar-border flex items-center gap-3">
      <div
        class="h-10 w-10 rounded-lg flex items-center justify-center overflow-hidden"
      >
        <img src="/ffui.svg" alt="FFUI" class="h-10 w-10" />
      </div>
      <h1 class="font-semibold text-lg text-sidebar-foreground leading-none" data-testid="ffui-sidebar-title">
        {{ t("app.controlPanel") }}
      </h1>
    </div>

    <nav class="flex-1 px-3 py-4 space-y-2">
      <Button
        data-testid="ffui-tab-queue"
        variant="ghost"
        class="w-full justify-between px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'queue'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('queue')"
      >
        <span>{{ t("app.tabs.queue") }}</span>
        <span
          v-if="jobs.filter((j) => j.status === 'processing').length > 0"
          class="ml-auto w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
        />
      </Button>
      <Button
        data-testid="ffui-tab-presets"
        variant="ghost"
        class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'presets'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('presets')"
      >
        <span>{{ t("app.tabs.presets") }}</span>
      </Button>
      <Button
        data-testid="ffui-tab-media"
        variant="ghost"
        class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'media'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('media')"
      >
        <span>{{ t("app.tabs.media") }}</span>
      </Button>
      <Button
        data-testid="ffui-tab-monitor"
        variant="ghost"
        class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'monitor'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('monitor')"
      >
        <span>{{ t("app.tabs.monitor") }}</span>
      </Button>
      <Button
        data-testid="ffui-tab-settings"
        variant="ghost"
        class="w-full justify-between px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'settings'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('settings')"
      >
        <span>{{ t("app.tabs.settings") }}</span>
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
        class="flex w-full overflow-hidden rounded-md"
        data-testid="ffui-action-add-job-split"
      >
        <Button
          data-testid="ffui-action-add-job-files"
          variant="default"
          size="lg"
          class="flex-1 justify-center rounded-r-none"
          @click="emit('addJobFiles')"
        >
          <span>{{ t("app.actions.addJobFiles") }}</span>
        </Button>
        <Button
          data-testid="ffui-action-add-job-folder"
          variant="secondary"
          size="lg"
          class="shrink-0 justify-center rounded-l-none border-l border-border/60 px-4"
          @click="emit('addJobFolder')"
        >
          <span class="whitespace-nowrap">{{ t("app.actions.addJobFolder") }}</span>
        </Button>
      </div>
      <Button
        data-testid="ffui-action-smart-scan"
        variant="smartScan"
        size="lg"
        class="w-full justify-center"
        @click="emit('smartScan')"
      >
        <span>{{ t("app.actions.smartScan") }}</span>
      </Button>
    </div>
  </aside>
</template>
