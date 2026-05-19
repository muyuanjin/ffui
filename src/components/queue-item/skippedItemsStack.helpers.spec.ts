import { describe, expect, it } from "vitest";

import { parseSkippedJobReason } from "./skippedItemsStack.helpers";

const zhMessages: Record<string, string> = {
  "queue.skipReasons.alreadyTargetFormat": "已是 {format} 格式",
  "queue.skipReasons.existingTargetSibling": "已有同名 {format} 文件",
};

const t = (key: string, values?: Record<string, unknown>) => {
  const template = zhMessages[key] ?? key;
  return Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  );
};

describe("parseSkippedJobReason", () => {
  it("localizes already target format skip reasons for AVIF and WEBP", () => {
    expect(parseSkippedJobReason({ reason: "Already AVIF", jobType: "image", t })).toBe("已是 AVIF 格式");
    expect(parseSkippedJobReason({ reason: "Already WEBP", jobType: "image", t })).toBe("已是 WEBP 格式");
  });

  it("localizes existing target sibling skip reasons for AVIF and WEBP", () => {
    expect(parseSkippedJobReason({ reason: "Existing .avif sibling", jobType: "image", t })).toBe("已有同名 AVIF 文件");
    expect(parseSkippedJobReason({ reason: "Existing .webp sibling", jobType: "image", t })).toBe("已有同名 WEBP 文件");
  });
});
