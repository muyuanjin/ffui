// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ensurePointerCaptureApi = () => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== "function") proto.hasPointerCapture = () => false;
  if (typeof proto.releasePointerCapture !== "function") proto.releasePointerCapture = () => {};
};

const TestSelect = {
  components: { Select, SelectContent, SelectItem, SelectTrigger, SelectValue },
  template: `
    <Select>
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

describe("reka-ui Select pointerup behavior", () => {
  it("prevents selecting an option on pointerup right after opening without movement", async () => {
    ensurePointerCaptureApi();
    const wrapper = mount(TestSelect, { attachTo: document.body });
    const trigger = wrapper.get('[data-testid="trigger"]');

    trigger.element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }),
    );
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");

    const firstOption = document.body.querySelector('[role="option"]') as HTMLElement | null;
    expect(firstOption).not.toBeNull();

    const pointerUp = new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    firstOption!.dispatchEvent(pointerUp);
    expect(pointerUp.defaultPrevented).toBe(true);

    wrapper.unmount();
  });

  it("closes on pointerup over trigger if the pointer moved far enough", async () => {
    ensurePointerCaptureApi();
    const wrapper = mount(TestSelect, { attachTo: document.body });
    const trigger = wrapper.get('[data-testid="trigger"]');

    await trigger.trigger("pointerdown");
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");

    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    trigger.element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });

  it("still closes on pointerup outside when the pointer moved far enough", async () => {
    ensurePointerCaptureApi();
    const wrapper = mount(TestSelect, { attachTo: document.body });
    const trigger = wrapper.get('[data-testid="trigger"]');

    await trigger.trigger("pointerdown");
    await nextTick();
    expect(trigger.attributes("aria-expanded")).toBe("true");

    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });
});
