// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

import SettingsAppUpdatesSection from "@/components/panels/SettingsAppUpdatesSection.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import type { AppSettings } from "@/types";
import { buildBatchCompressDefaults } from "./helpers/batchCompressDefaults";

vi.mock("@/lib/backend", () => {
  return {
    hasTauri: () => true,
  };
});

const makeI18n = () =>
  createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      en: en as any,
      "zh-CN": zhCN as any,
    },
  });

describe("SettingsAppUpdatesSection localized highlights", () => {
  it("renders localized highlights and updates immediately when locale changes", async () => {
    const i18n = makeI18n();
    const body = `# FFUI v0.2.1

## English

### Highlights

- English A
- English B

## 中文

### 重点更新

- 中文一
- 中文二
`;

    const wrapper = mount(SettingsAppUpdatesSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings: {
          tools: { autoDownload: true, autoUpdate: true },
          batchCompressDefaults: buildBatchCompressDefaults(),
          previewCapturePercent: 25,
        } satisfies AppSettings,
        appUpdate: {
          available: true,
          checking: false,
          installing: false,
          configured: true,
          availableVersion: "0.2.1",
          availableBody: body,
          currentVersion: "0.2.0",
          lastCheckedAtMs: null,
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
        },
        checkForAppUpdate: async () => {},
        installAppUpdate: async () => {},
      },
    });

    expect(wrapper.get("[data-testid='settings-current-version']").text()).toContain("v0.2.0");

    const zhHighlights = wrapper.findAll("[data-testid='settings-update-highlight-item']").map((node) => node.text());
    expect(zhHighlights.join("\n")).toContain("中文一");
    expect(zhHighlights.join("\n")).toContain("中文二");
    expect(zhHighlights.join("\n")).not.toContain("English A");

    i18n.global.locale.value = "en";
    await nextTick();

    const enHighlights = wrapper.findAll("[data-testid='settings-update-highlight-item']").map((node) => node.text());
    expect(enHighlights.join("\n")).toContain("English A");
    expect(enHighlights.join("\n")).toContain("English B");
    expect(enHighlights.join("\n")).not.toContain("中文一");

    wrapper.unmount();
  });

  it("falls back to autoCheckDefault when appSettings.updater.autoCheck is missing, and emits updater patch on toggle", async () => {
    const i18n = makeI18n();

    const appSettings: AppSettings = {
      tools: { autoDownload: true, autoUpdate: true },
      batchCompressDefaults: buildBatchCompressDefaults(),
      previewCapturePercent: 25,
      updater: undefined,
    };

    const wrapper = mount(SettingsAppUpdatesSection, {
      global: { plugins: [i18n] },
      props: {
        appSettings,
        appUpdate: {
          available: false,
          checking: false,
          installing: false,
          configured: true,
          autoCheckDefault: false,
          availableVersion: null,
          availableBody: null,
          currentVersion: "0.2.0",
          lastCheckedAtMs: null,
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
        },
      },
    });

    const checkbox = wrapper.get("[data-testid='settings-auto-check-updates']");
    expect(checkbox.attributes("data-state")).not.toBe("checked");

    await checkbox.trigger("click");
    await nextTick();

    const updates = wrapper.emitted("update:appSettings");
    expect(updates?.length).toBe(1);
    expect((updates?.[0]?.[0] as AppSettings).updater?.autoCheck).toBe(true);

    wrapper.unmount();
  });
});
