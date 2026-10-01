<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { useI18n } from "vue-i18n";
import { hasTauri } from "@/lib/backend";
import { Button } from "@/components/ui/button";
const FfmpegCommandDialog = defineAsyncComponent(() => import("@/components/dialogs/FfmpegCommandDialog.vue"));
const open = ref(false);
const { t } = useI18n();
</script>

<template>
  <Button
    v-if="hasTauri()"
    type="button"
    variant="commandTask"
    size="lg"
    class="min-w-0 justify-center rounded-none px-2 font-semibold text-white"
    :aria-label="t('queue.command.add')"
    :title="t('queue.command.add')"
    data-testid="add-ffmpeg-command"
    @click="open = true"
  >
    <span class="min-w-0 truncate">{{ t("queue.command.entry") }}</span>
  </Button>
  <FfmpegCommandDialog v-if="open" v-model:open="open" />
</template>
