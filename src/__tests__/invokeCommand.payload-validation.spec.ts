// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assertCanonicalInvokePayload } from "@/lib/backend/invokeCommand";

describe("invokeCommand payload validation", () => {
  it("accepts nested plain objects and arrays", () => {
    expect(() =>
      assertCanonicalInvokePayload({
        hello: { world: [1, 2, { ok: true }] },
      }),
    ).not.toThrow();
  });

  it("rejects nested __proto__/constructor/prototype keys (own enumerable)", () => {
    const nested = Object.create(null) as Record<string, unknown>;
    nested["__proto__"] = { polluted: true };

    expect(() =>
      assertCanonicalInvokePayload({
        nested,
      }),
    ).toThrow(/__proto__/);
  });

  it("rejects objects with a non-plain prototype (proto pollution style)", () => {
    const payload: Record<string, unknown> = {};
    (payload as any).__proto__ = { polluted: true };
    expect(() => assertCanonicalInvokePayload(payload)).toThrow(/JSON-like/);
  });
});
