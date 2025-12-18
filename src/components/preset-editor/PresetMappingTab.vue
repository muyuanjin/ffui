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
  <div class="bg-muted/40 p-3 rounded-md border border-border/60 space-y-3">
    <h3 class="font-semibold mb-2 text-sm border-b border-border/60 pb-1">
      {{ t("presetEditor.panel.mappingTitle") }}
    </h3>

    <div class="">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.mapLabel") }}
      </Label>
      <Textarea
        :model-value="(mapping.maps ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.mapPlaceholder')"
        class="min-h-[60px] text-[10px] font-mono"
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

    <div class="">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.dispositionLabel") }}
      </Label>
      <Textarea
        :model-value="(mapping.dispositions ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.dispositionPlaceholder')"
        class="min-h-[50px] text-[10px] font-mono"
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

    <div class="">
      <Label class="text-[10px] mb-1 block">
        {{ t("presetEditor.panel.metadataLabel") }}
      </Label>
      <Textarea
        :model-value="(mapping.metadata ?? []).join('\n')"
        :placeholder="t('presetEditor.panel.metadataPlaceholder')"
        class="min-h-[50px] text-[10px] font-mono"
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
  </div>
</template>
