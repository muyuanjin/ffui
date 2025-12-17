// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import Sidebar from "@/components/Sidebar.vue";
import en from "@/locales/en";
import zhCN from "@/locales/zh-CN";
import { FFUI_GITHUB_REPO_URL } from "@/constants/community";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: en as any,
    "zh-CN": zhCN as any,
  },
});

describe("Sidebar", () => {
  it("shows current tab title and hint", () => {
    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.get("[data-testid='ffui-sidebar-active-title']").text()).toBe(
      "Transcode Queue",
    );
    expect(wrapper.get("[data-testid='ffui-sidebar-active-hint']").text()).toContain(
      "Manage the transcoding queue",
    );
  });

  it("renders an icon for each navigation item", () => {
    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    expect(wrapper.find("[data-testid='ffui-tab-queue'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-presets'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-media'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-monitor'] svg").exists()).toBe(true);
    expect(wrapper.find("[data-testid='ffui-tab-settings'] svg").exists()).toBe(true);
  });

  it("opens the GitHub repo when clicking the logo", async () => {
    const openSpy = vi.fn();
    Object.defineProperty(window, "open", { value: openSpy, writable: true });

    const wrapper = mount(Sidebar, {
      props: {
        activeTab: "queue",
        jobs: [],
      },
      global: {
        plugins: [i18n],
      },
    });

    await wrapper.get("[data-testid='ffui-sidebar-logo-link']").trigger("click");

    expect(openSpy).toHaveBeenCalledWith(
      FFUI_GITHUB_REPO_URL,
      "_blank",
      "noopener,noreferrer",
    );
  });
});
