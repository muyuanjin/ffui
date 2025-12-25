// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import SettingsExitAutoWaitSection from "@/components/panels/SettingsExitAutoWaitSection.vue";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, ExternalToolSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": zhCN as any,
  },
});

const makeTools = (): ExternalToolSettings => ({
  ffmpegPath: undefined,
  ffprobePath: undefined,
  avifencPath: undefined,
  autoDownload: true,
  autoUpdate: true,
  downloaded: undefined,
});

const makeAppSettings = (patch?: Partial<AppSettings>): AppSettings => ({
  tools: makeTools(),
  batchCompressDefaults: buildBatchCompressDefaults(),
  previewCapturePercent: 25,
  developerModeEnabled: false,
  taskbarProgressMode: "byEstimatedTime",
  queuePersistenceMode: "crashRecoveryLite",
  ...patch,
});

describe("SettingsExitAutoWaitSection", () => {
  it("shows defaults when settings are unset", () => {
    const wrapper = mount(SettingsExitAutoWaitSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings({ exitAutoWaitEnabled: undefined, exitAutoWaitTimeoutSeconds: undefined }),
      },
    });

    expect(wrapper.find('input[data-testid="settings-exit-auto-wait-timeout"]').exists()).toBe(true);
    const input = wrapper.get('input[data-testid="settings-exit-auto-wait-timeout"]').element as HTMLInputElement;
    expect(input.value).toBe("5");

    wrapper.unmount();
  });

  it("shows a hint when crash recovery persistence is off", () => {
    const wrapper = mount(SettingsExitAutoWaitSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings({ queuePersistenceMode: "none", exitAutoWaitEnabled: true }),
      },
    });

    expect(wrapper.text()).toContain("提示：此模式在重启后不会保留已完成任务列表。");
    wrapper.unmount();
  });

  it("emits updates when toggled or timeout changes", async () => {
    const wrapper = mount(SettingsExitAutoWaitSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: makeAppSettings(),
      },
    });

    wrapper.getComponent(Switch).vm.$emit("update:modelValue", false);
    const first = wrapper.emitted("update:appSettings")?.[0]?.[0] as AppSettings | undefined;
    expect(first?.exitAutoWaitEnabled).toBe(false);

    await wrapper.setProps({ appSettings: first });
    expect(wrapper.find('input[data-testid="settings-exit-auto-wait-timeout"]').exists()).toBe(false);

    wrapper.getComponent(Switch).vm.$emit("update:modelValue", true);
    const second = wrapper.emitted("update:appSettings")?.[1]?.[0] as AppSettings | undefined;
    expect(second?.exitAutoWaitEnabled).toBe(true);

    await wrapper.setProps({ appSettings: second });
    await wrapper.get('input[data-testid="settings-exit-auto-wait-timeout"]').setValue("12");
    const third = wrapper.emitted("update:appSettings")?.[2]?.[0] as AppSettings | undefined;
    expect(third?.exitAutoWaitTimeoutSeconds).toBe(12);

    await wrapper.setProps({ appSettings: third });
    await wrapper.get('input[data-testid="settings-exit-auto-wait-timeout"]').setValue("0");
    const fourth = wrapper.emitted("update:appSettings")?.[3]?.[0] as AppSettings | undefined;
    expect(fourth?.exitAutoWaitTimeoutSeconds).toBe(0);

    await wrapper.setProps({ appSettings: fourth });
    await wrapper.get('input[data-testid="settings-exit-auto-wait-timeout"]').setValue("-1");
    const fifth = wrapper.emitted("update:appSettings")?.[4]?.[0] as AppSettings | undefined;
    expect(fifth?.exitAutoWaitTimeoutSeconds).toBe(-1);

    wrapper.unmount();
  });
});
