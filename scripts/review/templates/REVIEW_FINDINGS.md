---
schema: ffui-review-findings/v1
ledgerStatus: resolved
findings: []
---

# Review Findings

本文件是 checkout-local 的 findings 台账，永不提交（见 .gitignore）。一条 finding 只记一个独立根因，
字段契约由 scripts/review.mjs 校验：

- `owner`：承载该关系的规范 owner（仓库内路径或模块）。
- `condition`：最小可复现条件。
- `impact`：可观察的正确性/安全/维护性后果。
- `requiredOutcome`：修好后必须保持的稳定验收条件。
- `implementationPlan`：动手前写清「为什么可达、哪些 owner 与消费者要改、哪个观察能区分修好与没修好」；
  证据改变诊断或范围时先更新它，不要写成流水账。
- `resolutionEvidence`：已完成的观察与结果（不是打算做什么）。

状态：`unresolved` / `resolved` / `invalid` / `accepted`。`resolved` 还需要非空 `implementationPlan` 与
`resolutionEvidence`；`accepted` 需要 `dispositionRef` 指向承担该限制的追踪文件或外部 issue。
只有全部 finding 终态时，`ledgerStatus` 才能是 `resolved`。

校验器只检查结构，不能证明诊断或证据成立；每条处置都必须能被未来维护者按引用来源独立复核。

样例条目（需要时替换 `findings: []`）：

```yaml
findings:
  - id: F001
    severity: P1
    status: unresolved
    dispositionRef:
    owner: src/composables/main-app/context/foo.ts
    condition: >-
      在 X 条件下重复触发两次导出。
    impact: >-
      第二次提交覆盖第一次结果，用户拿到错误的产物。
    requiredOutcome: >-
      重复提交被串行化，同一时刻只有一次导出在途。
    implementationPlan:
    resolutionEvidence:
```
