# 推送前独立 review（硬门禁）

本仓库在 `git push` 处强制「先独立 review、再推送」：没有与待推送内容绑定的 review proof，推送会被 `.husky/pre-push` 拒绝，且没有豁免。

## 状态文件（checkout-local，永不提交）

| 文件                          | 作用                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `REVIEW_PLAN.json`            | 唯一有效的计划来源：`obligations[]` 定义标准义务，`lanes[]` 按**语义职责**（不是文件数量）划分审查车道 |
| `REVIEW_FINDINGS.md`          | findings 台账；结构由 `scripts/review.mjs` 校验                                                        |
| `.git/review-state/`          | 计划记录、车道结论、门禁结果与 proof（只在 Git 元数据里）                                              |
| `.cache/review/evidence/*.md` | 各车道的独立 review 报告                                                                               |

## 车道怎么划

每个车道声明 `scope`、`paths`、`dependsOn`、`obligations`、`owners`、`consumers`、`counterexamples`。
要点：

- base 以来**变更的每个路径都必须属于至少一个车道**，`review:plan` 会逐条校验。
- 车道按语义责任划分；同一个 owner 的多个调用点通常属于同一车道。
- `counterexamples` 必须写一个**能否证该车道**的判别性反例，不能写「看起来没问题」。
- 排除某个标准义务要在 `obligations[]` 里写 `disposition: n/a` 并给出具体理由。

## 流程

```sh
pnpm run review:plan:new                        # 首次创建计划（已存在时加 --force 覆盖）
pnpm run review:findings:new                    # 首次创建台账
# 编辑 REVIEW_PLAN.json 填入真实车道
pnpm run review:plan -- --base origin/main      # 记录计划；base 以来路径全覆盖才会通过
pnpm run review:status                          # 打印每条车道的 fingerprint 与有效性
# 对每条车道交给独立 reviewer（只给该车道的语义边界与项目上下文，不给实施者的结论）
pnpm run review:lane -- --lane <id> --evidence .cache/review/evidence/<id>.md
pnpm run review:gate                            # 干净工作树跑 pnpm run check:all 并记录
pnpm run review:finalize                        # 生成 proof
git push
```

## 证据报告格式

报告正文自由，但必须包含并以下面这行结尾：

```text
HEAD: <候选提交 sha>
FINGERPRINT: <review:status 打印的车道 fingerprint>
LANE: <车道 id>
... 结论与依据 ...
VERDICT: NO FINDINGS
```

`VERDICT:` 取值：`NO FINDINGS`（clean）、`FINDINGS`、`INCOMPLETE`。后两者都不是 clean 证据：
证据不足、被打断、覆盖缺口一律记 `INCOMPLETE`。

`FINGERPRINT` 与 `LANE` 是**必填**行：缺失即拒绝，`FINGERPRINT` 与当前不一致时同样拒绝——它绑定的是车道声明路径的内容，
这才是「审的是不是当前版本」的权威。
`HEAD` 只作来源记录（不一致时打印提示）：不相关的提交不应作废某条车道的结论，否则每次提交都得重跑全部车道。

## 修完之后重跑哪些车道

改动哪个车道的输入（或它声明依赖的上游指纹变化），就重跑该车道及其依赖闭包；未受影响的车道结论继续有效。
计划定义本身变化（增删车道、改 paths/obligations）后必须重新 `review:plan`，旧结论全部失效。

## 门禁命令与不可覆盖

门禁固定为 `pnpm run check:all`（`scripts/review.mjs` 的 `DEFAULT_GATE`），**不接受命令行覆盖**；
`gate.json` 记录的命令不是该值时，`finalize` 与 `pre-push` 都会拒绝，避免用一个恒为 0 的命令伪造「门禁通过」。
`gate` 与 `pre-push` 会先运行 `review:selftest`（门禁引擎自身的不变量，数量由实现打印）；自检失败直接拒绝。

## 结论的失效粒度

每条结论绑定「车道**定义**哈希 + 该车道 paths 的**内容**指纹」。重新记录计划时，定义未变的车道保留结论，
只有定义变化的车道（及其依赖闭包）失效；内容变化的车道失效。这与 dsh-ptc-plus 的「未受影响车道继续有效」一致。

## 已知限制（不声称已解决）

- 本地钩子可被 `git push --no-verify` 或 `HUSKY=0` 有意绕过；仓库没有服务端复核。钩子保证的是「按流程推送时未审内容被拒」，
  不是「任何推送都被审」。绕过即等于跳过本门禁。
- `scripts/review.mjs` 没有 Vitest 覆盖（Vitest 的 `include` 只含 `src/**` 与 `tools/docs-screenshots/__tests__`）；
  它靠 `review:selftest` 保护纯函数不变量，`pre-push` 与 `gate` 每次都会执行。
- `pre-push` 会重新校验计划、每条车道的结论与指纹、台账与门禁记录，而不是只读 `proof.json`；
  但它仍无法阻止有人**有意**同时伪造这些本地状态文件。

## 门禁对「脏」的判定

`review:gate` 与 `review:finalize` 只拒绝**已跟踪文件**的未提交变更：proof、车道指纹与门禁结果都绑定提交树，
未跟踪的本地产物（例如 `docs/adr/`、截图 fixture）不会进入推送，因此不算脏。

## 与 dsh-ptc-plus 的差异（有意为之）

- **只卡 pre-push**：本仓库提交频率高，把 proof 绑到 pre-commit 会阻断日常小提交；门禁落在真正对外的一步。
- **门禁只跑一条命令**：`pnpm run check:all`，不额外引入 verify/coverage 双入口。
- **不搬 epoch 轮换**：结论失效靠「车道定义哈希 + 内容指纹 + 依赖闭包」三者判定，语义等价且更易审计。
- **不搬 pre-commit 证明**：本仓库提交频繁，`proof` 只在 `finalize` 生成并由 `pre-push` 消费。
- **保留状态锁**：`plan`/`lane`/`gate`/`finalize` 共用一个 `.git/review-state/state.lock`；崩溃后确认无活动命令，
  只删除该目录再重试（不会自动回收）。
