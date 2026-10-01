<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { enqueueFfmpegJob, parseFfmpegCommand } from "@/lib/backend";
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

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const name = ref("");
const command = ref("");
const workingDirectory = ref("");
const error = ref<string | null>(null);
const args = ref<string[] | null>(null);
const parsing = ref(false);
const submitting = ref(false);
let revision = 0;
let closed = false;

const canSubmit = computed(() => props.open && !closed && args.value !== null && !parsing.value && !submitting.value);

watch(
  [() => props.open, command],
  async ([open, value]) => {
    const requestRevision = ++revision;
    closed = !open;
    args.value = null;
    error.value = null;
    parsing.value = false;
    if (!open || !value.trim()) return;
    parsing.value = true;
    let parsed: string[];
    try {
      parsed = await parseFfmpegCommand(value);
    } catch (reason) {
      if (revision === requestRevision && !closed) {
        error.value = String(reason);
        parsing.value = false;
      }
      return;
    }
    if (revision !== requestRevision || closed) return;
    args.value = parsed;
    parsing.value = false;
  },
  { flush: "sync" },
);

const changeOpen = (open: boolean) => {
  if (!open) {
    closed = true;
    revision += 1;
    args.value = null;
  }
  emit("update:open", open);
};

onBeforeUnmount(() => {
  closed = true;
  revision += 1;
});

const submit = async () => {
  if (!canSubmit.value || !args.value) return;
  const requestRevision = revision;
  const request = {
    name: name.value.trim() || t("queue.command.defaultName"),
    args: [...args.value],
    workingDirectory: workingDirectory.value || null,
  };
  error.value = null;
  submitting.value = true;
  try {
    await enqueueFfmpegJob(request);
  } catch (reason) {
    if (revision === requestRevision && !closed) error.value = String(reason);
    submitting.value = false;
    return;
  }
  submitting.value = false;
  if (revision === requestRevision && !closed) changeOpen(false);
};
</script>

<template>
  <Dialog :open="open" @update:open="changeOpen">
    <DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="ffmpeg-command-dialog">
      <DialogHeader>
        <DialogTitle>{{ t("queue.command.title") }}</DialogTitle>
        <DialogDescription>{{ t("queue.command.description") }}</DialogDescription>
      </DialogHeader>
      <form class="space-y-3" @submit.prevent="submit">
        <label class="block space-y-1">
          <span>{{ t("queue.command.input") }}</span>
          <Textarea
            v-model="command"
            class="min-h-28 font-mono"
            data-testid="ffmpeg-command-input"
            :placeholder="t('queue.command.placeholder')"
            :disabled="submitting"
            spellcheck="false"
          />
        </label>
        <p class="text-xs text-muted-foreground">{{ t("queue.command.syntax") }}</p>
        <p v-if="parsing" role="status" class="text-sm text-muted-foreground">{{ t("queue.command.parsing") }}</p>
        <section v-if="args" data-testid="ffmpeg-command-preview" class="space-y-2 rounded border p-3">
          <h3 class="text-sm font-medium">{{ t("queue.command.preview", { count: args.length }) }}</h3>
          <p class="text-xs text-muted-foreground">{{ t("queue.command.previewHint") }}</p>
          <ol class="max-h-36 list-inside list-decimal overflow-auto font-mono text-xs">
            <li v-for="(argument, index) in args" :key="index" class="whitespace-pre-wrap break-all">
              {{ argument === "" ? t("queue.command.emptyArgument") : argument }}
            </li>
          </ol>
        </section>
        <details data-testid="ffmpeg-command-advanced" class="space-y-3 rounded border p-3">
          <summary class="cursor-pointer text-sm font-medium">{{ t("queue.command.advanced") }}</summary>
          <label class="block space-y-1 text-sm">
            <span>{{ t("queue.command.name") }}</span>
            <Input
              v-model="name"
              data-testid="ffmpeg-command-name"
              :placeholder="t('queue.command.defaultName')"
              :disabled="submitting"
            />
          </label>
          <label class="block space-y-1 text-sm">
            <span>{{ t("queue.command.directory") }}</span>
            <Input v-model="workingDirectory" data-testid="ffmpeg-command-directory" :disabled="submitting" />
            <span class="block text-xs text-muted-foreground">{{ t("queue.command.directoryHint") }}</span>
          </label>
        </details>
        <p class="text-sm text-amber-600 dark:text-amber-400" data-testid="ffmpeg-command-risk">
          {{ t("queue.command.risk") }}
        </p>
        <p v-if="error" role="alert" class="text-destructive">{{ error }}</p>
        <DialogFooter>
          <Button type="submit" :disabled="!canSubmit" data-testid="ffmpeg-command-submit">{{
            t("queue.command.enqueue")
          }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
