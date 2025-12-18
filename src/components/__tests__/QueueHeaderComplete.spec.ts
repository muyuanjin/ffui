// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import QueueHeaderComplete from "@/components/QueueHeaderComplete.vue";

describe("QueueHeaderComplete SelectItem value 校验", () => {
  it("所有 SelectItem 的 value 都不是空字符串", () => {
    // 静态模板级别的防御性检查，确保不会再次引入空字符串 value 的 SelectItem
    const source = readFileSync(resolve(__dirname, "../QueueHeaderComplete.vue"), "utf8");
    expect(source).not.toContain('<SelectItem value="">');

    // 同时简单挂载一次组件，确保基本渲染路径保持可用
    const wrapper = mount(QueueHeaderComplete, {
      props: { totalCount: 10, filteredCount: 5 },
    });
    expect(wrapper.text()).toContain("队列模式");
  });
});
