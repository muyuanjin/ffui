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

describe("reka-ui Select outside pointer events", () => {
  it("disables outside pointer events while open (reka default)", async () => {
    ensurePointerCaptureApi();
    document.body.style.pointerEvents = "";

    const TestSelect = {
      components: { Select, SelectContent, SelectItem, SelectTrigger, SelectValue },
      template: `
        <Select>
          <SelectTrigger data-testid="trigger">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">A</SelectItem>
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

    // By default, Select disables outside pointer events while open.
    expect(document.body.style.pointerEvents).toBe("none");

    // Select an option to close.
    const optionA = document.body.querySelector('[role="option"]') as HTMLElement | null;
    expect(optionA).not.toBeNull();
    optionA!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        buttons: 1,
      }),
    );
    optionA!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
    await nextTick();
    await nextTick();

    expect(trigger.attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
    document.body.style.pointerEvents = "";
  });
});
