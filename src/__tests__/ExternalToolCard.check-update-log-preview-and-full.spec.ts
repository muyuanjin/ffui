// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import zhCN from "@/locales/zh-CN";
import ExternalToolCard from "@/components/panels/settings-external-tools/ExternalToolCard.vue";
import type { ExternalToolStatus } from "@/types";

const i18n = createI18n({
  legacy: false,
  locale: "zh-CN",
  messages: {
    "zh-CN": zhCN as any,
  },
});

describe("ExternalToolCard check update log preview + full log hover", () => {
  it("shows the log inside the check-updates hover content", () => {
    const tool: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "path",
      version: "ffmpeg version 6.0",
      updateCheckResult: "upToDate",
      updateAvailable: false,
      autoDownloadEnabled: false,
      autoUpdateEnabled: false,
      downloadInProgress: false,
    };

    const checkUpdateLogs = Array.from({ length: 10 }, (_, idx) => ({
      atMs: 1_700_000_000_000 + idx * 1000,
      level: "info" as const,
      message: `Line ${idx + 1}`,
    }));

    const wrapper = mount(ExternalToolCard, {
      props: {
        tool,
        toolStatusesFresh: true,
        appSettings: null,
        toolCustomPath: "",
        candidatesOpen: false,
        candidatesLoading: false,
        candidates: [],
        checkUpdateLogs,
        checkUpdateLoading: false,
        checkUpdateDisabled: false,
        recentlyChecked: false,
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: `<div><slot /></div>` },
          HoverCardTrigger: { template: `<div><slot /></div>` },
          HoverCardContent: { template: `<div><slot /></div>` },
          Button: { template: `<button><slot /></button>` },
          Input: { template: `<input />` },
        },
      },
    });

    const hoverLog = wrapper.get('[data-testid="tool-check-update-hover-log-ffmpeg"]');
    expect(hoverLog.text()).toContain("Line 1");
    expect(hoverLog.text()).toContain("Line 10");
  });

  it("shows an 'unknown' hint and still allows switching to the recommended remote version", () => {
    const tool: ExternalToolStatus = {
      kind: "ffmpeg",
      resolvedPath: "C:/tools/ffmpeg.exe",
      source: "custom",
      version: "ffmpeg version N-121700-g36e5576a44-20251108",
      remoteVersion: "6.1.1",
      updateCheckResult: "unknown",
      updateAvailable: false,
      autoDownloadEnabled: false,
      autoUpdateEnabled: false,
      downloadInProgress: false,
    };

    const wrapper = mount(ExternalToolCard, {
      props: {
        tool,
        toolStatusesFresh: true,
        appSettings: null,
        toolCustomPath: "",
        candidatesOpen: false,
        candidatesLoading: false,
        candidates: [],
        checkUpdateLogs: [],
        checkUpdateLoading: false,
        checkUpdateDisabled: false,
        recentlyChecked: false,
      },
      global: {
        plugins: [i18n],
        stubs: {
          HoverCard: { template: `<div><slot /></div>` },
          HoverCardTrigger: { template: `<div><slot /></div>` },
          HoverCardContent: { template: `<div><slot /></div>` },
          Button: { template: `<button><slot /></button>` },
          Input: { template: `<input />` },
        },
      },
    });

    expect(wrapper.text()).toContain("版本不可比较");
    expect(wrapper.text()).not.toContain("已是最新版本");
    expect(wrapper.text()).toContain("更新");
    wrapper.unmount();
  });
});
