<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import type { AppLocale } from "@/i18n";
import { DEFAULT_LOCALE, loadLocale } from "@/i18n";

defineProps<{
  /** Progress percent for header bar (0-100) */
  progressPercent: number;
  /** Whether progress is visible */
  progressVisible: boolean;
  /** Whether progress is fading out */
  progressFading: boolean;
}>();

const emit = defineEmits<{
  minimize: [];
  toggleMaximize: [];
  close: [];
}>();

const { t, locale } = useI18n();

const currentLocale = computed<AppLocale>({
  get: () =>
    locale.value === "zh-CN" || locale.value === "en" ? (locale.value as AppLocale) : DEFAULT_LOCALE,
  set: (value) => {
    void loadLocale(value);
  },
});
</script>

<template>
  <header
    data-tauri-drag-region
    class="relative flex items-center justify-between h-10 px-4 border-b border-border bg-secondary/90 backdrop-blur-sm select-none overflow-hidden"
  >
    <div
      v-if="progressVisible"
      class="absolute inset-y-0 left-0 pointer-events-none transition-[width,opacity] duration-700 ease-out z-0 bg-gradient-to-r from-emerald-500/50 via-cyan-400/50 to-fuchsia-500/50 shadow-lg"
      :class="progressFading ? 'opacity-0' : 'opacity-100'"
      :style="{ width: `${progressPercent}%` }"
    />
    <div class="relative z-10 flex items-center justify-between w-full">
      <div
        class="flex items-center gap-3 h-full text-sm font-semibold tracking-wide text-sidebar-foreground/90"
      >
        <span class="inline-flex h-4 w-4 rounded-full bg-primary/80" />
        <span class="truncate">
          {{ t("app.title") }}
        </span>
      </div>
      <div class="flex items-center gap-3" data-tauri-drag-region="false">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <Select v-model="currentLocale">
            <SelectTrigger
              class="h-7 px-3 py-0 text-xs rounded-full bg-card/80 border border-border/60 text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">
                {{ t("app.lang.zh") }}
              </SelectItem>
              <SelectItem value="en">
                {{ t("app.lang.en") }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border-border/70 bg-card/70 text-foreground hover:bg-card/90"
          title="Minimize"
          @click="emit('minimize')"
        >
          <span class="text-sm">─</span>
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border-border/70 bg-card/70 text-foreground hover:bg-card/90"
          title="Maximize"
          @click="emit('toggleMaximize')"
        >
          <span class="text-xs">▢</span>
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          class="h-7 w-7 rounded-md border border-destructive/70 bg-destructive/80 text-destructive-foreground hover:bg-destructive"
          title="Close"
          @click="emit('close')"
        >
          <span class="text-sm font-semibold">✕</span>
        </Button>
      </div>
    </div>
  </header>
</template>
