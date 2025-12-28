// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ensurePointerCaptureApi = () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== "function") proto.hasPointerCapture = () => false;
  if (typeof proto.setPointerCapture !== "function") proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== "function") proto.releasePointerCapture = () => {};
};

describe("reka-ui Select selection", () => {
  it("selects an option on pointerup and closes the content", async () => {
    ensurePointerCaptureApi();

    const TestSelect = {
      components: { Select, SelectContent, SelectItem, SelectTrigger, SelectValue },
      setup() {
        const value = ref<string | undefined>(undefined);
        return { value };
      },
      template: `
        <Select v-model="value">
          <SelectTrigger data-testid="trigger">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
            <SelectItem value="b">B</SelectItem>
          </SelectContent>
        </Select>
      `,
    };

    const wrapper = mount(TestSelect, { attachTo: document.body });
    const trigger = wrapper.get('[data-testid="trigger"]');

    trigger.element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      }),
    );
    await nextTick();
    trigger.element.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");

    const options = Array.from(document.body.querySelectorAll('[role="option"]')) as HTMLElement[];
    const optionB = options.find((el) => el.textContent?.trim() === "B");
    expect(optionB).toBeTruthy();

    optionB!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      }),
    );
    const optionPointerUp = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
    optionB!.dispatchEvent(optionPointerUp);
    await nextTick();
    await nextTick();

    expect(optionPointerUp.defaultPrevented).toBe(false);
    expect((wrapper.vm as any).value).toBe("b");
    expect(wrapper.text()).toContain("B");
    expect(trigger.attributes("aria-expanded")).toBe("false");

    wrapper.unmount();
  });
});
