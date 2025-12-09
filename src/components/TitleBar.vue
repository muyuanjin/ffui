<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "vue-i18n";
import type { AppLocale } from "@/i18n";
import { DEFAULT_LOCALE, loadLocale } from "@/i18n";
import { Minus, Square, X } from "lucide-vue-next";

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
      class="absolute inset-y-0 left-0 pointer-events-none transition-[width,opacity] duration-300 ease-linear z-0 bg-gradient-to-r from-emerald-500/50 via-cyan-400/50 to-fuchsia-500/50 shadow-lg"
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
          variant="ghost"
          size="icon-sm"
          class="h-8 w-8 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
          :title="t('app.minimize')"
          @click="emit('minimize')"
        >
          <Minus class="h-4 w-4" :stroke-width="1.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-8 w-8 rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-muted/60 transition-colors"
          :title="t('app.maximize')"
          @click="emit('toggleMaximize')"
        >
          <Square class="h-3.5 w-3.5" :stroke-width="1.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="h-8 w-8 rounded-lg text-muted-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors"
          :title="t('app.close')"
          @click="emit('close')"
        >
          <X class="h-4 w-4" :stroke-width="1.5" />
        </Button>
      </div>
    </div>
  </header>
</template>
