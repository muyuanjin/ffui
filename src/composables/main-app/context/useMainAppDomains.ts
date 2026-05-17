import type { MainAppDomains } from "@/MainApp.types";
import { useMainAppBatchCompress } from "@/composables/main-app/useMainAppBatchCompress";
import { useMainAppMedia } from "@/composables/main-app/useMainAppMedia";
import { useMainAppPreview } from "@/composables/main-app/useMainAppPreview";
import { useMainAppSharedState } from "./useMainAppSharedState";
import { useMainAppShellDomain } from "./useMainAppShellDomain";
import { useMainAppDialogsBase, useMainAppDialogsDomain } from "./useMainAppDialogsDomain";
import { useMainAppSettingsDomain } from "./useMainAppSettingsDomain";
import { useMainAppPresetsDomain } from "./useMainAppPresetsDomain";
import { useMainAppQueueDomain } from "./useMainAppQueueDomain";
import { useMainAppGlobalEffects } from "./useMainAppGlobalEffects";

export function useMainAppDomains(): MainAppDomains {
  const state = useMainAppSharedState();
  const shell = useMainAppShellDomain(state.t);
  const dialogsBase = useMainAppDialogsBase();

  const batchCompress = useMainAppBatchCompress({
    t: state.t,
    activeTab: shell.activeTab,
    jobs: state.jobs,
    presets: state.presets,
    queueError: state.queueError,
    lastDroppedRoot: state.lastDroppedRoot,
    dialogManager: dialogsBase.dialogManager,
  });

  const settings = useMainAppSettingsDomain({ state, batchCompress });
  const presetsModule = useMainAppPresetsDomain({
    state,
    shell,
    dialogs: dialogsBase,
    settings,
  });
  const media = useMainAppMedia({
    t: state.t,
    activeTab: shell.activeTab,
  });
  const preview = useMainAppPreview({
    presets: state.presets,
    dialogManager: dialogsBase.dialogManager,
    t: state.t,
  });
  const queue = useMainAppQueueDomain({
    state,
    shell,
    dialogs: dialogsBase,
    media,
    presets: presetsModule,
    settings,
    batchCompress,
  });
  const dialogs = useMainAppDialogsDomain({
    dialogs: dialogsBase,
    batchCompress,
    settings,
  });

  useMainAppGlobalEffects({
    state,
    dialogs,
    presets: presetsModule,
    queue,
    settings,
  });

  return {
    shell,
    dialogs,
    presetsModule,
    queue,
    media,
    preview,
    settings,
  };
}
