<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useI18n } from "vue-i18n";
import type { AppSettings } from "@/types";

const props = defineProps<{
  appSettings: AppSettings;
}>();

const emit = defineEmits<{
  "update:appSettings": [settings: AppSettings];
}>();

const { t } = useI18n();

type CrashRecoveryRetention = NonNullable<AppSettings["crashRecoveryLogRetention"]>;

const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
  emit("update:appSettings", { ...props.appSettings, [key]: value });
};

const updateCrashRecoveryLogRetention = (patch: Partial<CrashRecoveryRetention>) => {
  const existing =
    (props.appSettings.crashRecoveryLogRetention ??
      ({} as CrashRecoveryRetention)) as CrashRecoveryRetention;
  updateSetting("crashRecoveryLogRetention", { ...existing, ...patch });
};
</script>

<template>
  <div class="py-1 space-y-1.5">
    <p class="text-[11px] font-medium text-foreground">
      {{ t("app.settings.queuePersistenceLabel") }}
    </p>
    <RadioGroup
      class="grid gap-0.5"
      :model-value="appSettings.queuePersistenceMode ?? 'none'"
      @update:model-value="(v) => updateSetting('queuePersistenceMode', v as any)"
    >
      <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
        <RadioGroupItem
          id="queue-persistence-none"
          value="none"
          class="mt-[2px] h-3 w-3 border-border/50"
        />
        <span class="text-[10px] leading-snug select-none">
          {{ t("app.settings.queuePersistenceNoneOption") }}
        </span>
      </label>

      <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
        <RadioGroupItem
          id="queue-persistence-crash-recovery-lite"
          value="crashRecoveryLite"
          class="mt-[2px] h-3 w-3 border-border/50"
        />
        <span class="text-[10px] leading-snug select-none">
          {{ t("app.settings.queuePersistenceCrashRecoveryLiteOption") }}
        </span>
      </label>

      <label class="flex items-start gap-1.5 cursor-pointer p-1 rounded hover:bg-accent/5">
        <RadioGroupItem
          id="queue-persistence-crash-recovery-full"
          value="crashRecoveryFull"
          class="mt-[2px] h-3 w-3 border-border/50"
        />
        <span class="text-[10px] leading-snug select-none">
          {{ t("app.settings.queuePersistenceCrashRecoveryFullOption") }}
        </span>
      </label>

      <div
        v-if="appSettings.queuePersistenceMode === 'crashRecoveryFull'"
        class="mt-1 rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5"
        data-testid="queue-persistence-full-hint"
      >
        <p class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
          {{ t("app.settings.queuePersistenceCrashRecoveryFullHint") }}
        </p>
        <div class="mt-1 grid grid-cols-2 gap-2">
          <div class="flex items-center justify-between gap-2">
            <label class="text-[10px] text-muted-foreground">
              {{ t("app.settings.crashRecoveryMaxLogFilesLabel") }}
            </label>
            <Input
              :model-value="appSettings.crashRecoveryLogRetention?.maxFiles ?? 200"
              type="number"
              min="0"
              max="5000"
              class="w-16 h-6 text-[10px] font-mono text-center"
              @update:model-value="(v) => updateCrashRecoveryLogRetention({
                maxFiles: Number(v),
              })"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <label class="text-[10px] text-muted-foreground">
              {{ t("app.settings.crashRecoveryMaxLogTotalMbLabel") }}
            </label>
            <Input
              :model-value="appSettings.crashRecoveryLogRetention?.maxTotalMb ?? 512"
              type="number"
              min="0"
              max="32768"
              class="w-16 h-6 text-[10px] font-mono text-center"
              @update:model-value="(v) => updateCrashRecoveryLogRetention({
                maxTotalMb: Number(v),
              })"
            />
          </div>
        </div>
      </div>
    </RadioGroup>
  </div>
</template>
