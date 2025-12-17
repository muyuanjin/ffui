// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import WaitingJobContextMenu from "@/components/main/WaitingJobContextMenu.vue";

describe("WaitingJobContextMenu", () => {
  it("renders lucide icons for actions", () => {
    const wrapper = mount(WaitingJobContextMenu, {
      props: {
        visible: true,
      },
    });

    const menu = wrapper.get("[data-testid='waiting-job-context-menu']");
    const svgs = menu.findAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });
});
