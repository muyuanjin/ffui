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
  <div v-if="hasTauri()" class="flex justify-end">
    <Button variant="outline" size="sm" data-testid="add-ffmpeg-command" @click="open = true">{{
      t("queue.command.title")
    }}</Button>
  </div>
  <FfmpegCommandDialog v-if="open" v-model:open="open" />
</template>
