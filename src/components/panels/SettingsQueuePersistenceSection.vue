<script setup lang="ts">
import { Input } from "@/components/ui/input";
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
  <div class="flex items-start gap-2">
    <label class="text-[10px] text-muted-foreground leading-snug">
      {{ t("app.settings.queuePersistenceLabel") }}
    </label>
    <div class="flex flex-col gap-1">
      <label class="flex items-center gap-1">
        <input
          id="queue-persistence-none"
          type="radio"
          name="queue-persistence-mode"
          class="w-3 h-3 rounded-full border-border/50"
          :checked="!appSettings.queuePersistenceMode || appSettings.queuePersistenceMode === 'none'"
          @change="updateSetting('queuePersistenceMode', 'none')"
        />
        <span class="text-[10px] text-muted-foreground cursor-pointer select-none">
          {{ t("app.settings.queuePersistenceNoneOption") }}
        </span>
      </label>

      <label class="flex items-center gap-1">
        <input
          id="queue-persistence-crash-recovery-lite"
          type="radio"
          name="queue-persistence-mode"
          class="w-3 h-3 rounded-full border-border/50"
          :checked="appSettings.queuePersistenceMode === 'crashRecoveryLite'"
          @change="updateSetting('queuePersistenceMode', 'crashRecoveryLite')"
        />
        <span class="text-[10px] text-muted-foreground cursor-pointer select-none">
          {{ t("app.settings.queuePersistenceCrashRecoveryLiteOption") }}
        </span>
      </label>

      <label class="flex items-center gap-1">
        <input
          id="queue-persistence-crash-recovery-full"
          type="radio"
          name="queue-persistence-mode"
          class="w-3 h-3 rounded-full border-border/50"
          :checked="appSettings.queuePersistenceMode === 'crashRecoveryFull'"
          @change="updateSetting('queuePersistenceMode', 'crashRecoveryFull')"
        />
        <span class="text-[10px] text-muted-foreground cursor-pointer select-none">
          {{ t("app.settings.queuePersistenceCrashRecoveryFullOption") }}
        </span>
      </label>

      <div
        v-if="appSettings.queuePersistenceMode === 'crashRecoveryFull'"
        class="mt-0.5 rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-1"
        data-testid="queue-persistence-full-hint"
      >
        <p class="text-[9px] leading-snug text-amber-700 dark:text-amber-400">
          {{ t("app.settings.queuePersistenceCrashRecoveryFullHint") }}
        </p>
        <div class="mt-1 grid grid-cols-2 gap-1.5">
          <div class="flex items-center justify-between gap-1">
            <label class="text-[9px] text-muted-foreground">
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
          <div class="flex items-center justify-between gap-1">
            <label class="text-[9px] text-muted-foreground">
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
    </div>
  </div>
</template>

