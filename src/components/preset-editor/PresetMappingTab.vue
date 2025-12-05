<script setup lang="ts">
import type { MappingConfig } from "@/types";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  mapping: MappingConfig;
}>();

const mapping = props.mapping as any;

const { t } = useI18n();
</script>

<template>
  <div class="bg-muted/40 p-4 rounded-md border border-border/60 space-y-4">
    <h3 class="font-semibold mb-2 border-b border-border/60 pb-2">
      {{ t("presetEditor.panel.mappingTitle", "流映射与元数据") }}
    </h3>

    <div class="space-y-2">
      <Label class="text-xs">
        {{ t("presetEditor.panel.mapLabel", "显式 -map 规则（每行一条）") }}
      </Label>
      <Textarea
        :model-value="(mapping.maps ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.mapPlaceholder', '例如 0:v:0\\n0:a:0? 保留第一路视频与音频')"
        class="min-h-[72px] text-[11px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.maps = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <div class="space-y-2">
      <Label class="text-xs">
        {{ t("presetEditor.panel.dispositionLabel", "-disposition 规则（每行一条）") }}
      </Label>
      <Textarea
        :model-value="(mapping.dispositions ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.dispositionPlaceholder', '例如 0:v:0 default\\n0:a:0 default')"
        class="min-h-[60px] text-[11px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.dispositions = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <div class="space-y-2">
      <Label class="text-xs">
        {{ t("presetEditor.panel.metadataLabel", "-metadata 键值对（每行 key=value）") }}
      </Label>
      <Textarea
        :model-value="(mapping.metadata ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.metadataPlaceholder', 'title=My Video\\nartist=Someone')"
        class="min-h-[60px] text-[11px] font-mono"
        @update:model-value="
          (value) => {
            const text = String(value ?? '');
            const lines = text
              .split('\n')
              .map((v) => v.trim())
              .filter((v) => v.length > 0);
            mapping.metadata = lines.length > 0 ? lines : undefined;
          }
        "
      />
    </div>

    <p class="text-[11px] text-muted-foreground">
      {{
        t(
          "presetEditor.panel.mappingHelp",
          "若不填写，ffmpeg 会使用默认映射行为；只有在需要精细控制轨道与元数据时才建议手动配置。",
        )
      }}
    </p>
  </div>
</template>

