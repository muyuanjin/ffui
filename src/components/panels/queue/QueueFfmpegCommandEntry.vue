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
    variant="outline"
    size="lg"
    class="w-full justify-center font-semibold"
    data-testid="add-ffmpeg-command"
    @click="open = true"
    >{{ t("queue.command.add") }}</Button
  >
  <FfmpegCommandDialog v-if="open" v-model:open="open" />
</template>
