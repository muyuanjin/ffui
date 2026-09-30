<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { enqueueFfmpegJob } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const name = ref("");
const argumentsJson = ref("[]");
const workingDirectory = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);

const submit = async () => {
  if (submitting.value) return;
  error.value = null;
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson.value);
  } catch {
    error.value = t("queue.command.invalid");
    return;
  }
  if (
    !name.value.trim() ||
    !Array.isArray(args) ||
    !args.length ||
    !args.every((argument) => typeof argument === "string")
  ) {
    error.value = t("queue.command.invalid");
    return;
  }
  submitting.value = true;
  try {
    await enqueueFfmpegJob({ name: name.value, args, workingDirectory: workingDirectory.value || null });
    emit("update:open", false);
  } catch (reason) {
    error.value = String(reason);
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t("queue.command.title") }}</DialogTitle>
        <DialogDescription>{{ t("queue.command.description") }}</DialogDescription>
      </DialogHeader>
      <form class="space-y-3" @submit.prevent="submit">
        <label class="block space-y-1">
          <span>{{ t("queue.command.name") }}</span>
          <Input v-model="name" data-testid="ffmpeg-command-name" :disabled="submitting" />
        </label>
        <label class="block space-y-1">
          <span>{{ t("queue.command.args") }}</span>
          <Textarea
            v-model="argumentsJson"
            class="font-mono"
            data-testid="ffmpeg-command-args"
            :disabled="submitting"
          />
        </label>
        <label class="block space-y-1">
          <span>{{ t("queue.command.directory") }}</span>
          <Input v-model="workingDirectory" data-testid="ffmpeg-command-directory" :disabled="submitting" />
        </label>
        <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="submitting" data-testid="ffmpeg-command-submit">{{
            t("queue.command.enqueue")
          }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
