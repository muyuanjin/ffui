<script setup lang="ts">
import { Video, Music, Image as ImageIcon } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  badges: readonly { kind: "all" | "video" | "audio" | "image"; label: string; title: string }[];
  badgeTestId: string;
  uppercase?: boolean;
}>();
</script>

<template>
  <div class="group inline-flex min-w-0 max-w-full items-center">
    <span
      v-for="(badge, index) in badges"
      :key="badge.kind"
      :data-testid="badgeTestId"
      :data-media-kind="badge.kind"
      :title="badge.title"
      :aria-label="badge.title"
      class="inline-flex h-7 min-w-0 items-center gap-1 border border-border/40 border-r-0 bg-[#90a4ae]/60 px-2 text-[10px] font-semibold text-white/85 transition-colors group-hover:bg-[#90a4ae]/70"
      :class="[index === 0 ? 'rounded-l-full' : '', badge.kind === 'all' ? 'max-w-40' : 'max-w-24']"
    >
      <component
        :is="badge.kind === 'video' ? Video : badge.kind === 'audio' ? Music : ImageIcon"
        v-if="badge.kind !== 'all'"
        class="h-3 w-3 shrink-0 text-white/65"
        aria-hidden="true"
      />
      <span v-if="badge.kind !== 'all'" class="sr-only">{{ t(`formatSelect.groups.${badge.kind}`) }}</span>
      <span class="truncate" :class="uppercase ? 'uppercase' : ''">{{ badge.label }}</span>
    </span>
    <slot trigger-class="h-7 shrink-0 rounded-full rounded-l-none px-3 py-0 text-xs font-semibold text-white" />
  </div>
</template>
