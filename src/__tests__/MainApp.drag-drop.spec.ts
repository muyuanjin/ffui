// @vitest-environment jsdom
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
  it("handleDragOver and handleDragLeave toggle isDragging for DOM drag events", () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;

    expect(vm.isDragging).toBe(false);

    const dragEvent = {
      preventDefault: () => {},
      dataTransfer: null,
    } as unknown as DragEvent;

    vm.handleDragOver(dragEvent);
    expect(vm.isDragging).toBe(true);

    vm.handleDragLeave();
    expect(vm.isDragging).toBe(false);
  });

  it("handleDrop clears isDragging after a DOM drop event", () => {
    const wrapper = mount(MainApp, {
      global: {
        plugins: [i18n],
      },
    });

    const vm: any = wrapper.vm;
    vm.isDragging = true;

    const dropEvent = {
      preventDefault: () => {},
      dataTransfer: {
        files: [],
      },
    } as unknown as DragEvent;

    vm.handleDrop(dropEvent);
    expect(vm.isDragging).toBe(false);
  });
});
