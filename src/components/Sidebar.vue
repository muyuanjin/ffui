<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "vue-i18n";
import type { TranscodeJob } from "@/types";

defineProps<{
  /** Current active tab */
  activeTab: "queue" | "presets" | "media" | "monitor" | "settings";
  /** List of all jobs (for processing indicator) */
  jobs: TranscodeJob[];
}>();

const emit = defineEmits<{
  "update:activeTab": [tab: "queue" | "presets" | "media" | "monitor" | "settings"];
  addJob: [];
  smartScan: [];
}>();

const { t } = useI18n();

const setActiveTab = (tab: "queue" | "presets" | "media" | "monitor" | "settings") => {
  emit("update:activeTab", tab);
};
</script>

<template>
  <aside class="w-64 bg-sidebar border-r border-sidebar-border flex flex-col">
    <div class="shrink-0 px-5 py-4 border-b border-sidebar-border flex items-center gap-3">
      <div
        class="h-8 w-8 rounded-md border border-sidebar-ring bg-sidebar-accent flex items-center justify-center text-[10px] font-semibold tracking-[0.15em] text-sidebar-primary uppercase"
      >
        FF
      </div>
      <div class="space-y-0.5">
        <h1 class="font-semibold text-sm text-sidebar-foreground leading-none">
          {{ t("app.controlPanel") }}
        </h1>
        <Badge
          variant="outline"
          class="text-[10px] px-1.5 py-0 border-sidebar-border text-sidebar-foreground/70 uppercase tracking-wide"
        >
          {{ t("app.controlPanel") }}
        </Badge>
      </div>
    </div>

    <nav class="flex-1 px-3 py-4 space-y-2">
      <Button
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
        variant="ghost"
        class="w-full justify-start px-4 h-11 rounded-lg text-sm font-medium"
        :class="
          activeTab === 'settings'
            ? 'bg-sidebar-accent text-sidebar-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
        "
        @click="setActiveTab('settings')"
      >
        <span>{{ t("app.tabs.settings") }}</span>
      </Button>
    </nav>

    <div class="shrink-0 px-4 py-4 border-t border-sidebar-border space-y-3">
      <Button
        variant="default"
        size="lg"
        class="w-full justify-center"
        @click="emit('addJob')"
      >
        <span>{{ t("app.actions.addJob") }}</span>
      </Button>
      <Button
        variant="secondary"
        size="lg"
        class="w-full justify-center"
        @click="emit('smartScan')"
      >
        <span>{{ t("app.actions.smartScan") }}</span>
      </Button>
    </div>
  </aside>
</template>
