import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import MainApp from "@/MainApp.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

describe("MainApp drag & drop state", () => {
  it("handleTauriFileDropHover toggles isDragging only when media files are present", () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    // Non-media paths should not enable dragging overlay.
    vm.handleTauriFileDropHover(["C:/temp/readme.txt", "C:/temp/data.json"]);
    expect(vm.isDragging).toBe(false);

    // Media paths should enable dragging overlay.
    vm.handleTauriFileDropHover([
      "C:/videos/movie.mp4",
      "C:/images/photo.jpg",
      "C:/temp/readme.txt",
    ]);
    expect(vm.isDragging).toBe(true);
  });

  it("handleTauriFileDrop sets lastDroppedRoot and clears dragging state", () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    vm.isDragging = true;
    vm.handleTauriFileDrop(["C/videos/test.mp4"]);

    expect(vm.isDragging).toBe(false);
    expect(vm.lastDroppedRoot).toBe("C/videos");
  });
});
