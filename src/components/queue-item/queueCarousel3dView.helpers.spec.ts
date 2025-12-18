import { describe, it, expect } from "vitest";
import { computeCarousel3DLayout, computeCarouselCardStyle } from "./queueCarousel3dView.helpers";

describe("queueCarousel3dView.helpers", () => {
  it("computes a responsive layout that keeps cards within the stage", () => {
    const layout = computeCarousel3DLayout({ stageWidth: 1600, stageHeight: 820 });
    expect(layout.cardWidth).toBeGreaterThan(0);
    expect(layout.cardWidth).toBeLessThanOrEqual(1600);
    expect(layout.cardHeight).toBeGreaterThan(0);
    expect(layout.cardHeight).toBeLessThanOrEqual(820);
    expect(layout.translateXStep).toBeGreaterThan(0);
    expect(layout.translateZStep).toBeGreaterThan(0);
    expect(layout.perspectivePx).toBeGreaterThan(0);
  });

  it("keeps enough horizontal space to reveal adjacent cards on large stages", () => {
    const layout = computeCarousel3DLayout({ stageWidth: 2400, stageHeight: 980 });
    // Guardrail: active card should not occupy the entire stage width.
    expect(layout.cardWidth / layout.stageWidth).toBeLessThanOrEqual(0.9);
  });

  it("uses layout-driven translate and perspective values (no fixed constants)", () => {
    const layout = computeCarousel3DLayout({ stageWidth: 1400, stageHeight: 720 });
    const style = computeCarouselCardStyle({
      index: 1,
      activeIndex: 0,
      totalCards: 10,
      isDragging: false,
      dragOffset: 0,
      layout,
    });

    expect(style.transform).toContain(`perspective(${layout.perspectivePx}px)`);
    expect(style.transform).toContain(`translateX(${layout.translateXStep}px)`);
    expect(style.transform).toContain(`translateZ(-${layout.translateZStep}px)`);
  });
});
