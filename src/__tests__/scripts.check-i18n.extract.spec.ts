import { describe, expect, it } from "vitest";
import { extractTKeysFromContent } from "../../scripts/check-i18n.mjs";

describe("scripts/check-i18n extractTKeysFromContent", () => {
  it("extracts t() keys for double/single/template strings", () => {
    const content = `
      t("app.title");
      t('queue.add');
      t(\`presetEditor.save\`);
    `;

    expect([...extractTKeysFromContent(content)].sort()).toEqual(["app.title", "presetEditor.save", "queue.add"]);
  });

  it("ignores interpolated template literals", () => {
    const content = "t(`app.${section}`); t(`static.key`);";
    expect([...extractTKeysFromContent(content)].sort()).toEqual(["static.key"]);
  });

  it("does not match unrelated identifiers", () => {
    const content = "notT('a.b'); tt('c.d');";
    expect([...extractTKeysFromContent(content)]).toEqual([]);
  });
});
