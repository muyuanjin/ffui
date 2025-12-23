<script setup lang="ts">
import type { ContainerConfig, DeepWritable } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "vue-i18n";
import { computed, ref } from "vue";
import { FORMAT_CATALOG, filterFormatCatalog, groupFormatCatalog } from "@/lib/formatCatalog";

const props = defineProps<{
  container: ContainerConfig;
}>();

const container: DeepWritable<ContainerConfig> = props.container;

const { t } = useI18n();

const query = ref("");
const entries = computed(() => FORMAT_CATALOG);
const filtered = computed(() => filterFormatCatalog(entries.value, query.value));
const groups = computed(() => groupFormatCatalog(filtered.value));
</script>

<template>
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-3 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.containerTitle") }}
    </h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div class="space-y-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.formatLabel") }}
        </Label>
        <Select
          :model-value="container.format ?? '__auto__'"
          @update:model-value="
            (value) => {
              const v = String(value ?? '__auto__');
              container.format = v === '__auto__' ? undefined : v;
            }
          "
        >
          <SelectTrigger class="h-9 text-xs">
            <SelectValue :placeholder="t('presetEditor.panel.formatPlaceholder')" />
          </SelectTrigger>
          <SelectContent>
            <div class="p-1">
              <Input v-model="query" class="h-8 text-xs" placeholder="搜索：mp4 / .mp4 / matroska / m2ts ..." />
            </div>
            <Separator class="my-1" />
            <SelectItem value="__auto__">
              {{ t("presetEditor.panel.formatAutoOption") }}
            </SelectItem>
            <Separator class="my-1" />

            <template v-if="groups.video.length">
              <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">视频</div>
              <SelectItem v-for="e in groups.video" :key="e.value" :value="e.value">
                <div class="flex flex-col">
                  <span class="text-sm">{{ e.label }}</span>
                  <span v-if="e.note" class="text-[10px] text-muted-foreground leading-tight">{{ e.note }}</span>
                </div>
              </SelectItem>
            </template>

            <template v-if="groups.audio.length">
              <Separator class="my-1" />
              <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">音频</div>
              <SelectItem v-for="e in groups.audio" :key="e.value" :value="e.value" :disabled="true">
                <div class="flex flex-col">
                  <span class="text-sm">{{ e.label }}</span>
                  <span class="text-[10px] text-muted-foreground leading-tight">仅音频；当前结构化视频预设不启用</span>
                </div>
              </SelectItem>
            </template>

            <template v-if="groups.image.length">
              <Separator class="my-1" />
              <div class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">图片</div>
              <SelectItem v-for="e in groups.image" :key="e.value" :value="e.value" :disabled="true">
                <div class="flex flex-col">
                  <span class="text-sm">{{ e.label }}</span>
                  <span class="text-[10px] text-muted-foreground leading-tight">图片格式；当前容器设置不启用</span>
                </div>
              </SelectItem>
            </template>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1">
        <Label class="text-[10px] mb-1 block">
          {{ t("presetEditor.panel.movflagsLabel") }}
        </Label>
        <Input
          :model-value="(container.movflags ?? []).join('+')"
          :placeholder="t('presetEditor.panel.movflagsPlaceholder')"
          class="h-8 text-xs font-mono"
          @update:model-value="
            (value) => {
              const text = String(value ?? '');
              const flags = text
                .split(/[+,]/)
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
              container.movflags = flags.length > 0 ? flags : undefined;
            }
          "
        />
      </div>
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{ t("presetEditor.panel.containerHelp") }}
    </p>
  </div>
</template>
