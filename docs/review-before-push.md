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
`gate.json` 记录的命令不是该值时，`finalize` 与 `pre-push` 都会拒绝。这里固定的是**命令字符串**：
它**不**阻止有人把 `package.json` 的 `check:all` 脚本本身（或它调用的脚本）改成恒成功——那属于改动被审内容，
会进入本次 diff 并被独立 review 看到，且 `gate.json` 另外绑定执行时的树。
`gate` 以 `FFUI_CHECK_ALL_COALESCE_FORCE=1` 运行该命令：`check:all` 的复用缓存（`.cache/check-all/coalesce/results/*.json`，本地未跟踪）
只影响耗时，**不再能决定被记录的退出码**——被记录的 0 必然来自一次真实运行；执行前还会清掉残留的死 owner 锁，
并给命令设 90 分钟上限（最坏是响亮失败，而不是永不返回）。
`gate` 与 `pre-push` 会先运行 `review:selftest`（门禁引擎自身的不变量，数量由实现打印）；自检失败直接拒绝。

## 审阅下界（base）

`review:plan -- --base <commit>` 记录的是「哪些改动属于本次审阅」。约束由 `baseDecision` 统一判定，
三个阶段（`plan`/`finalize`/`pre-push`）共用同一条链路，只有**阶段策略**不同：

- base 必须是 HEAD 的祖先，且**不得晚于** `merge-base(审阅下界, HEAD)`，否则 base 会吞掉未审改动、让覆盖校验空转。
  这两条在所有阶段都生效（与阶段策略无关）。
- 审阅下界默认取 `origin/main`；仓库没有该 ref 时，可在 `REVIEW_PLAN.json` 声明 `compareRef`（任何可解析为提交的 ref 或 sha）。
  两者都在时 **origin/main 优先**：自声明的下界不能覆盖远端基线。
- **所选 `base` 等于 HEAD**（`base..HEAD` 为空）时**只在记录计划（`plan`）阶段拒绝**，并强制首次记录显式给出 `--base`
  （没有隐式默认值）。判据是所选 base，不是 `origin/main`：远端基线会随着你自己的推送前进到 HEAD，
  此时用更早的 base 重录计划是完全合法的（区间非空），不能因为 `origin/main == HEAD` 就拒绝。
  同一原因，`finalize`/`pre-push` 也放行「审阅下界已包含 HEAD」的情况：被推内容已在对端，放行不会放过未审改动；
  未审改动仍被 `proof`/`gate` 的树绑定与车道指纹拦下（v0.3.4 的 tag 推送曾被这条误拒过一次）。
- 阶段策略是 `scripts/review.mjs` 里的数据（`BASE_PHASE_BY_COMMAND` + `DEGENERATE_BASE_PHASES`），调用点只声明命令名，
  由 `baseProblemForCommand` 查表。`review:selftest` 同时断言：阶段表的取值、纯判定函数 `baseDecision` 的两种模式、
  以及**真实 CLI 端到端**（一次性 git 仓库里跑 `plan --base HEAD` 必须拒绝、`origin/main == HEAD` 时用更早 base 必须通过）；
  另有一组**接线守卫**（`selftestWiringText`）：它是**防误改的绊线，不是语义证明**。它断言三处调用点、查表语句、委派语句、
  `phase: phase`/`baseCommit: baseCommit` 两处透传、以及 finalize/pre-push 两处消费语句行各自恰好出现一次，
  并要求调用语句行恰好 3 条、委派语句恰好 1 条、三个调用点按命令顺序出现。
  它能拦住的是：改写或删除被断言的语句行、把断言文本复制成**独立的语句行**（含死代码里的）、额外插入一条语句行形式的
  `return baseProblem(..., "plan")`、互换 finalize 与 pre-push 的调用点。只把同一文本写进注释不会失败，也不改变行为（无害）。
  **它的边界**是用守卫未覆盖的写法（`return (baseProblem(...))`、双空格、别名调用）**额外插入**覆盖语句：这类改动的保护不靠它，
  而是机制本身——任何对 `scripts/review.mjs` 的改动都会改变该车道的内容指纹，使既有结论失效并强制重跑独立 review。
  它也**不覆盖**把消费语句行包进 `if (false) {}` 或未调用函数：那不是等价改写，而是把 finalize/pre-push 的 base 复核变成死代码。
  该行为**可以**端到端构造：在一次性仓库里合成 plan/verdicts/gate/proof 后，真实代码 `finalize`（base == HEAD）退出 0；
  把调用点阶段改成 `"plan"` 则退出 1「base 等于 HEAD」；把消费行包进 `if (false) {}`（自检仍全绿）又回到退出 0。
  当前 `review:selftest` 尚未包含这条合成状态的端到端断言，因此这类死代码化目前只能靠内容指纹失效 + 强制重审拦住。
  对唯一的映射函数 `basePhaseFor` 另有**行为性**断言（plan/finalize/pre-push → 对应阶段）。

## 结论的失效粒度

每条结论绑定「车道**定义**哈希 + 该车道 paths 的**内容**指纹」。重新记录计划时，定义未变的车道保留结论，
只有定义变化的车道（及其依赖闭包）失效；内容变化的车道失效。这与 dsh-ptc-plus 的「未受影响车道继续有效」一致。

## 已知限制（不声称已解决）

- 本地钩子可被 `git push --no-verify` 或 `HUSKY=0` 有意绕过；仓库没有服务端复核。钩子保证的是「按流程推送时未审内容被拒」，
  不是「任何推送都被审」。绕过即等于跳过本门禁。
- `scripts/review.mjs` 没有 Vitest 覆盖（Vitest 的 `include` 只含 `src/**` 与 `tools/docs-screenshots/__tests__`）；
  它靠 `review:selftest`：纯函数不变量 + 一次性 git 仓库里跑**真实 CLI** 的端到端接线断言 + 针对本文件自身的
  接线文本断言。`pre-push` 与 `gate` 每次都会执行；文本断言是接线守卫（不是行为测试），改接线必须同步改它。
- `pre-push` 会重新校验计划、每条车道的结论与指纹、台账与门禁记录，而不是只读 `proof.json`；
  但它仍无法阻止有人**有意**同时伪造这些本地状态文件。

## 门禁对「脏」的判定

`review:gate` 与 `review:finalize` 只拒绝**已跟踪文件**的未提交变更：proof、车道指纹与门禁结果都绑定提交树，
未跟踪的本地产物（例如 `docs/adr/`、截图 fixture、`.cache/**` 下的各种缓存）不会进入推送，因此不算脏。
其中 `.cache/check-all/coalesce/results/*.json` 曾能直接决定 `check:all` 的退出码；现在 `gate` 强制真实执行（见上节）。
但**同类可伪造的结果缓存仍存在于工具链里**（例如 eslint 的 `--cache --cache-location .cache/eslint/.eslintcache`）：
伪造这些本地未跟踪状态，与用 `--no-verify` 绕过钩子属于同一类——**有意伪造本地状态即等于绕过本门禁**，
不在门禁能防的范围内（见上面的已知限制）。

## 与 dsh-ptc-plus 的差异（有意为之）

- **只卡 pre-push**：本仓库提交频率高，把 proof 绑到 pre-commit 会阻断日常小提交；门禁落在真正对外的一步。
- **门禁只跑一条命令**：`pnpm run check:all`，不额外引入 verify/coverage 双入口。
- **不搬 epoch 轮换**：结论失效靠「车道定义哈希 + 内容指纹 + 依赖闭包」三者判定，语义等价且更易审计。
- **不搬 pre-commit 证明**：本仓库提交频繁，`proof` 只在 `finalize` 生成并由 `pre-push` 消费。
- **保留状态锁**：`plan`/`lane`/`gate`/`finalize` 共用一个 `.git/review-state/state.lock`；崩溃后确认无活动命令，
  只删除该目录再重试（不会自动回收）。
