#!/usr/bin/env node
// 推送前独立 review 的门禁引擎。
//
// 契约：
// - REVIEW_PLAN.json（checkout-local，永不提交）是唯一有效的计划来源：按语义职责划分车道，
//   每个车道声明 scope/paths/obligations/owners/consumers/counterexamples。
// - REVIEW_FINDINGS.md（checkout-local，永不提交）是 findings 台账，schema 受本脚本校验。
// - 车道结论绑定「车道定义哈希 + 该车道 paths 在候选提交上的内容指纹」；两者任一变化即失效。
// - proof 只在 finalize 生成，绑定计划哈希、车道定义/内容哈希、证据哈希与门禁结果。
// - pre-push 钩子重新校验计划、结论、台账、门禁与 proof，而不是只信 proof 文件本身。
// - 局限（不声称已解决）：本地钩子可被 git push --no-verify / HUSKY=0 有意绕过；
//   钩子只能保证「按流程推送」时未审内容被拒。
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const GIT_DIR = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
const STATE_DIR = path.join(GIT_DIR, "review-state");
const PLAN_PATH = path.join(ROOT, "REVIEW_PLAN.json");
const FINDINGS_PATH = path.join(ROOT, "REVIEW_FINDINGS.md");
const TEMPLATE_DIR = path.join(ROOT, "scripts", "review", "templates");
const LOCK_DIR = path.join(STATE_DIR, "state.lock");
const PLAN_SCHEMA = "ffui-review-plan/v1";
const FINDINGS_SCHEMA = "ffui-review-findings/v1";
const DEFAULT_GATE = ["pnpm", "run", "check:all"];
const GATE_COMMAND_LABEL = DEFAULT_GATE.join(" ");
// 本地专用分支：只存在于本机，永远不推送。
export const PROTECTED_LOCAL_BRANCHES = ["caption-collage"];
const VERDICT_CLEAN = "NO FINDINGS";
const VERDICT_VALUES = [VERDICT_CLEAN, "FINDINGS", "INCOMPLETE"];
// 台账里合法的 finding 字段：多行正文中的「词:词」不能被误判成字段。
const FINDING_FIELDS = [
  "id",
  "severity",
  "status",
  "dispositionRef",
  "owner",
  "condition",
  "impact",
  "requiredOutcome",
  "implementationPlan",
  "resolutionEvidence",
];

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write("review: " + message + "\n");
  process.exit(1);
}

function note(message) {
  process.stdout.write(message + "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function short(hash) {
  return String(hash).slice(0, 16);
}

/** 递归按键排序后序列化，使哈希只反映语义内容。 */
export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(function (key) {
          return JSON.stringify(key) + ":" + stableStringify(value[key]);
        })
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export function planHash(plan) {
  return sha256(stableStringify(plan));
}

/** 单条车道的定义哈希：车道定义变化只作废该车道（及其依赖闭包）的结论。 */
export function laneHash(lane) {
  return sha256(stableStringify(lane));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function stateFile(name) {
  return path.join(STATE_DIR, name);
}

/** 串行化所有会改写 review 状态的命令；崩溃后按打印的路径手动恢复。 */
function withLock(body) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.mkdirSync(LOCK_DIR);
  } catch {
    fail("另一个 review 状态命令正在运行（锁目录 " + LOCK_DIR + "）。确认没有活动命令后，只删除该目录再重试。");
  }
  try {
    return body();
  } finally {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}

function trackedChanges() {
  return git(["status", "--porcelain", "--untracked-files=no"]).split("\n").filter(Boolean);
}

function ensureCleanWorktree(action) {
  // 只看已跟踪文件：proof 与车道指纹都绑定提交树，未跟踪的本地产物不会进入推送。
  const dirty = trackedChanges();
  if (dirty.length > 0) {
    fail(
      action + " 要求已跟踪文件无未提交变更，当前有 " + dirty.length + " 处：\n  " + dirty.slice(0, 10).join("\n  "),
    );
  }
}

function candidate() {
  return {
    head: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
    dirty: trackedChanges().length,
  };
}

/** 车道输入内容指纹：该车道 paths 在给定提交上的 blob 集合。 */
export function laneFingerprint(lane, treeish) {
  const revision = treeish || "HEAD";
  const entries = [];
  const inputs = lane.paths || [];
  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    const listing = tryGit(["ls-tree", "-r", "-z", revision, "--", input]);
    if (!listing) {
      entries.push(input + ":MISSING");
      continue;
    }
    const rows = listing.split("\u0000").filter(Boolean);
    for (let j = 0; j < rows.length; j += 1) {
      const parts = rows[j].split("\t");
      const objectId = parts[0].split(/\s+/)[2];
      entries.push(parts[1] + ":" + objectId);
    }
  }
  entries.sort();
  return short(sha256(entries.join("\n")));
}

function loadPlan() {
  if (!fs.existsSync(PLAN_PATH)) {
    fail("缺少 REVIEW_PLAN.json。先运行 pnpm run review:plan:new，并按语义职责填写。");
  }
  return readJson(PLAN_PATH);
}

function loadRecordedPlan() {
  const file = stateFile("plan.json");
  return fs.existsSync(file) ? readJson(file) : null;
}

function loadVerdicts() {
  const file = stateFile("verdicts.json");
  return fs.existsSync(file) ? readJson(file) : { planHash: null, lanes: {} };
}

function saveVerdicts(value) {
  writeJson(stateFile("verdicts.json"), value);
}

function loadProof() {
  const file = stateFile("proof.json");
  return fs.existsSync(file) ? readJson(file) : null;
}

function loadGate() {
  const file = stateFile("gate.json");
  return fs.existsSync(file) ? readJson(file) : null;
}

/** 校验计划结构，并在记录了 base 后要求变更路径全覆盖。 */
export function validatePlanShape(plan, recordedBase) {
  const problems = [];
  if (!plan || plan.schema !== PLAN_SCHEMA) problems.push("schema 必须是 " + PLAN_SCHEMA);
  if (plan && plan.compareRef != null && !String(plan.compareRef).trim()) {
    problems.push("compareRef 若存在必须是非空字符串（或省略）");
  }
  const obligations = (plan && plan.obligations) || [];
  const lanes = (plan && plan.lanes) || [];
  if (obligations.length === 0) problems.push("obligations 不能为空");
  if (lanes.length === 0) problems.push("lanes 不能为空");
  const knownObligations = new Set();
  for (let i = 0; i < obligations.length; i += 1) {
    const obligation = obligations[i];
    if (!obligation.id) problems.push("obligation 缺少 id");
    knownObligations.add(obligation.id);
    if (obligation.disposition !== "covered" && obligation.disposition !== "n/a") {
      problems.push("obligation " + obligation.id + " 的 disposition 必须是 covered 或 n/a");
    }
    if (obligation.disposition === "n/a" && !String(obligation.reason || "").trim()) {
      problems.push("obligation " + obligation.id + " 标记 n/a 时必须给出具体 reason");
    }
  }
  const laneIds = new Set();
  for (let i = 0; i < lanes.length; i += 1) {
    const lane = lanes[i];
    const label = lane.id || "<缺少 id>";
    if (!lane.id || lane.id === "replace-me") problems.push("lane 缺少 id（或仍是占位符）");
    if (laneIds.has(lane.id)) problems.push("lane id 重复：" + lane.id);
    laneIds.add(lane.id);
    if (!String(lane.scope || "").trim()) problems.push("lane " + label + " 缺少 scope");
    const listed = ["paths", "owners", "consumers", "counterexamples"];
    for (let k = 0; k < listed.length; k += 1) {
      const value = lane[listed[k]];
      if (!Array.isArray(value) || value.length === 0) {
        problems.push("lane " + label + " 缺少 " + listed[k]);
        continue;
      }
      for (let n = 0; n < value.length; n += 1) {
        if (String(value[n]).includes("Replace with"))
          problems.push("lane " + label + " 的 " + listed[k] + " 仍是占位符");
      }
    }
    const laneObligations = lane.obligations || [];
    for (let n = 0; n < laneObligations.length; n += 1) {
      if (!knownObligations.has(laneObligations[n])) {
        problems.push("lane " + label + " 引用了未定义 obligation：" + laneObligations[n]);
      }
    }
  }
  for (let i = 0; i < lanes.length; i += 1) {
    const dependencies = lanes[i].dependsOn || [];
    for (let n = 0; n < dependencies.length; n += 1) {
      if (!laneIds.has(dependencies[n])) {
        problems.push("lane " + (lanes[i].id || "<缺少 id>") + " 依赖了不存在的车道：" + dependencies[n]);
      }
    }
  }
  if (recordedBase) {
    const changed = git(["diff", "--name-only", recordedBase + "..HEAD"])
      .split("\n")
      .filter(Boolean);
    for (let i = 0; i < changed.length; i += 1) {
      const file = changed[i];
      const covered = lanes.some(function (lane) {
        return (lane.paths || []).some(function (input) {
          const prefix = input.charAt(input.length - 1) === "/" ? input : input + "/";
          return input === "." || file === input || file.indexOf(prefix) === 0;
        });
      });
      if (!covered) problems.push("变更路径未被任何车道覆盖：" + file);
    }
  }
  return problems;
}

/** 解析台账 front matter：schema、ledgerStatus 与 findings 结构。 */
export function parseLedger(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { schema: null, ledgerStatus: null, findings: [], error: "缺少 YAML front matter" };
  const lines = match[1].split(/\r?\n/);
  const findings = [];
  let current = null;
  let pendingKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 缩进决定层级：条目 ≤2、字段 =4、块标量正文 ≥6。这样正文里的 status: x 或 - x
    // 不会被当成字段/新条目（正文覆盖顶层字段、或合法 bullet 台账被误拒）。
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    const itemMatch = indent <= 2 ? /^-\s+(.*)$/.exec(trimmed) : null;
    if (itemMatch) {
      // 列表项缺少 id 时也保留条目（id 为空），让校验器报「存在缺少 id 的 finding」，
      // 而不是把整条 finding 静默丢弃、让 unresolved 计数归零。
      const idMatch = /^id:\s*(.*)$/.exec(itemMatch[1]);
      current = { id: idMatch ? idMatch[1].trim() : "" };
      findings.push(current);
      pendingKey = null;
      continue;
    }
    const fieldMatch = indent <= 4 ? /^([A-Za-z]+):\s*(.*)$/.exec(trimmed) : null;
    if (fieldMatch && current && FINDING_FIELDS.indexOf(fieldMatch[1]) >= 0) {
      const key = fieldMatch[1];
      const raw = fieldMatch[2];
      if (raw === ">-" || raw === "|" || raw === "") {
        current[key] = "";
        pendingKey = key;
      } else {
        current[key] = raw.trim();
        pendingKey = null;
      }
      continue;
    }
    if (pendingKey && current && /^\s{6,}\S/.test(line)) {
      current[pendingKey] = (current[pendingKey] + " " + line.trim()).trim();
    }
  }
  const schema = /^schema:\s*(.*)$/m.exec(match[1]);
  const ledgerStatus = /^ledgerStatus:\s*(.*)$/m.exec(match[1]);
  return {
    schema: schema ? schema[1].trim() : null,
    ledgerStatus: ledgerStatus ? ledgerStatus[1].trim() : null,
    findings: findings,
  };
}

export function validateLedger(ledger) {
  const problems = [];
  if (ledger.schema !== FINDINGS_SCHEMA) problems.push("台账 schema 必须是 " + FINDINGS_SCHEMA);
  if (!ledger.ledgerStatus) problems.push("台账缺少 ledgerStatus");
  const terminal = new Set(["resolved", "invalid", "accepted"]);
  for (let i = 0; i < ledger.findings.length; i += 1) {
    const finding = ledger.findings[i];
    const label = finding.id || "<缺少 id>";
    if (!finding.id) problems.push("存在缺少 id 的 finding");
    if (["P0", "P1", "P2", "P3"].indexOf(String(finding.severity || "")) < 0) {
      problems.push(label + " 的 severity 必须是 P0-P3");
    }
    if (!terminal.has(finding.status) && finding.status !== "unresolved") {
      problems.push(label + " 的 status 非法：" + finding.status);
    }
    const required = ["owner", "condition", "impact", "requiredOutcome"];
    for (let k = 0; k < required.length; k += 1) {
      if (!String(finding[required[k]] || "").trim()) problems.push(label + " 缺少 " + required[k]);
    }
    if (finding.status === "resolved") {
      const extra = ["implementationPlan", "resolutionEvidence"];
      for (let k = 0; k < extra.length; k += 1) {
        if (!String(finding[extra[k]] || "").trim()) problems.push(label + " 标记 resolved 时必须给出 " + extra[k]);
      }
    }
    if (finding.status === "accepted" && !String(finding.dispositionRef || "").trim()) {
      problems.push(label + " 标记 accepted 时必须给出 dispositionRef（追踪中的文件或外部 issue）");
    }
  }
  const unresolved = ledger.findings.filter(function (finding) {
    return finding.status === "unresolved";
  });
  if (unresolved.length > 0 && ledger.ledgerStatus === "resolved") {
    problems.push("仍有 unresolved finding，ledgerStatus 不能是 resolved");
  }
  if (unresolved.length === 0 && ledger.ledgerStatus !== "resolved") {
    problems.push("所有 finding 已终态，ledgerStatus 必须是 resolved");
  }
  return problems;
}

/** 门禁相关：未终结的 findings（结构是否合法由 validateLedger 判断）。 */
export function unresolvedFindings(ledger) {
  return ledger.findings.filter(function (finding) {
    return finding.status === "unresolved";
  });
}

function readLedger() {
  if (!fs.existsSync(FINDINGS_PATH)) {
    fail("缺少 REVIEW_FINDINGS.md。先运行 pnpm run review:findings:new。");
  }
  return parseLedger(fs.readFileSync(FINDINGS_PATH, "utf8"));
}

/** 车道有效性：车道定义未变、输入指纹未变、结论 clean，且依赖闭包内全部有效。 */
export function effectiveLanes(plan, verdicts, revision) {
  const byId = new Map(
    (plan.lanes || []).map(function (lane) {
      return [lane.id, lane];
    }),
  );
  const cache = new Map();
  const visit = function (id, stack) {
    if (cache.has(id)) return cache.get(id);
    if (stack.indexOf(id) >= 0) {
      cache.set(id, { effective: false, reason: "依赖成环" });
      return cache.get(id);
    }
    const lane = byId.get(id);
    if (!lane) {
      cache.set(id, { effective: false, reason: "车道不存在" });
      return cache.get(id);
    }
    const fingerprint = laneFingerprint(lane, revision);
    const definitionHash = laneHash(lane);
    const entry = verdicts.lanes[id];
    let result = { effective: false, reason: "没有结论", fingerprint: fingerprint, verdict: "missing" };
    if (entry) {
      result.verdict = entry.verdict;
      result.evidencePath = entry.evidencePath;
      if (entry.verdict !== VERDICT_CLEAN) {
        result.reason = "结论为 " + entry.verdict;
      } else if (entry.laneHash !== definitionHash) {
        result.reason = "车道定义已改变";
      } else if (entry.fingerprint !== fingerprint) {
        result.reason = "输入内容已变化";
      } else {
        const deps = lane.dependsOn || [];
        let blockedBy = null;
        for (let i = 0; i < deps.length; i += 1) {
          if (!visit(deps[i], stack.concat([id])).effective) blockedBy = deps[i];
        }
        if (blockedBy) result.reason = "上游车道无效：" + blockedBy;
        else {
          result = {
            effective: true,
            reason: "有效",
            fingerprint: fingerprint,
            verdict: entry.verdict,
            evidencePath: entry.evidencePath,
          };
        }
      }
    }
    cache.set(id, result);
    return result;
  };
  const out = new Map();
  for (let i = 0; i < (plan.lanes || []).length; i += 1) out.set(plan.lanes[i].id, visit(plan.lanes[i].id, []));
  return out;
}

function commandPlanNew(args) {
  if (fs.existsSync(PLAN_PATH) && args.indexOf("--force") < 0) fail("REVIEW_PLAN.json 已存在（要覆盖加 --force）");
  fs.copyFileSync(path.join(TEMPLATE_DIR, "REVIEW_PLAN.json"), PLAN_PATH);
  note("已创建 " + PLAN_PATH);
}

function commandFindingsNew(args) {
  if (fs.existsSync(FINDINGS_PATH) && args.indexOf("--force") < 0)
    fail("REVIEW_FINDINGS.md 已存在（要覆盖加 --force）");
  fs.copyFileSync(path.join(TEMPLATE_DIR, "REVIEW_FINDINGS.md"), FINDINGS_PATH);
  note("已创建 " + FINDINGS_PATH);
}

/**
 * 计划 base 的约束：必须是 HEAD 的祖先，且不得晚于 merge-base(审阅下界, HEAD)。
 *
 * 「审阅下界等于 HEAD」（没有可审差异）只在**记录计划**时才是缺陷：此时覆盖校验 base..HEAD 会空转。
 * finalize/pre-push 期间 origin/main 会随着自身的推送前进到 HEAD，此时按该规则判定会把已审内容
 * 误判为不可推送，因此退化检查按阶段开关。阶段策略是数据，由 selftest 直接断言，
 * 避免「漏传/写死该开关」这类改动无声通过自检。
 */
const DEGENERATE_BASE_PHASES = ["plan"];

/** 生产接线：命令 → base 约束阶段。selftest 直接断言这张表，并用真实 CLI 跑端到端。 */
const BASE_PHASE_BY_COMMAND = {
  plan: "plan",
  finalize: "finalize",
  "pre-push": "pre-push",
};

/** 该阶段是否要求存在可审差异（即拒绝退化的审阅下界）。 */
function requiresReviewable(phase) {
  return DEGENERATE_BASE_PHASES.indexOf(String(phase)) >= 0;
}

/** base 约束的纯判定：入参为已解析的 git 值与阶段，便于 selftest 断言两种模式。 */
function baseDecision(input) {
  if (input.ancestorOfHead === false) return "记录的 base 不是 HEAD 的祖先：" + input.shortBase;
  if (!input.reference) return "缺少审阅下界：仓库没有 origin/main，且 REVIEW_PLAN.json 未声明 compareRef";
  if (!input.referenceCommit) return "审阅下界无法解析：" + input.reference;
  if (!input.mergeBase) return "审阅下界与 HEAD 没有共同祖先：" + input.reference;
  // 判据是**所选 base 等于 HEAD**（base..HEAD 为空才让覆盖校验空转）。
  // 不能用「审阅下界等于 HEAD」：origin/main 会随自身推送前进到 HEAD，那时用更早的 base 重录计划是完全合法的。
  if (requiresReviewable(input.phase) && input.baseCommit === input.head) {
    return "base 等于 HEAD，没有可审的差异：" + input.shortBase;
  }
  if (input.baseAncestorOfMergeBase === false) {
    return (
      "base 不能晚于 merge-base(" +
      String(input.reference) +
      ", HEAD)=" +
      input.shortMergeBase +
      "：否则 base 会吞掉未审的改动，使覆盖校验空转"
    );
  }
  return null;
}

/** 命令 → 阶段：唯一的映射点；selftest 对本函数做**行为性**断言（不只看文本）。 */
function basePhaseFor(command) {
  const phase = BASE_PHASE_BY_COMMAND[String(command)];
  if (!phase) fail("未知命令的 base 阶段：" + String(command));
  return phase;
}

function baseProblemForCommand(command, plan, baseCommit) {
  return baseProblem(plan, baseCommit, basePhaseFor(command));
}

function baseProblem(plan, baseCommit, phase) {
  const head = git(["rev-parse", "HEAD"]);
  // origin/main 可解析时优先于计划里的 compareRef：自声明的下界不能覆盖远端基线。
  const originMain = tryGit(["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]);
  const declared = plan && plan.compareRef ? String(plan.compareRef) : null;
  const reference = originMain || declared;
  const referenceCommit = reference ? tryGit(["rev-parse", "--verify", "--quiet", reference + "^{commit}"]) : null;
  const mergeBase = referenceCommit ? tryGit(["merge-base", referenceCommit, "HEAD"]) : null;
  return baseDecision({
    ancestorOfHead: tryGit(["merge-base", "--is-ancestor", baseCommit, "HEAD"]) !== null,
    baseAncestorOfMergeBase: mergeBase
      ? tryGit(["merge-base", "--is-ancestor", baseCommit, mergeBase]) !== null
      : undefined,
    head: head,
    baseCommit: baseCommit,
    reference: reference,
    referenceCommit: referenceCommit,
    mergeBase: mergeBase,
    phase: phase,
    shortBase: short(baseCommit),
    shortMergeBase: mergeBase ? short(mergeBase) : "",
  });
}

function commandPlan(args) {
  const baseIndex = args.indexOf("--base");
  const plan = loadPlan();
  const previous = loadRecordedPlan();
  const baseRef = (baseIndex >= 0 ? args[baseIndex + 1] : null) || (previous && previous.baseCommit) || null;
  if (!baseRef) fail("首次记录必须显式给出 --base <commit>（不提供默认值，避免未审改动被并入 base）");
  const resolvedBase = tryGit(["rev-parse", "--verify", "--quiet", baseRef + "^{commit}"]);
  if (!resolvedBase) {
    fail("base 无法解析：" + baseRef + "（仓库没有 origin/main 时先 fetch，或在计划里声明 compareRef）");
  }
  const baseIssue = baseProblemForCommand("plan", plan, resolvedBase);
  if (baseIssue) fail(baseIssue);
  const problems = validatePlanShape(plan, resolvedBase);
  if (problems.length > 0) fail("计划无效：\n  " + problems.join("\n  "));
  return withLock(function () {
    const previousVerdicts = loadVerdicts();
    const kept = {};
    const lanes = plan.lanes || [];
    for (let i = 0; i < lanes.length; i += 1) {
      const entry = previousVerdicts.lanes[lanes[i].id];
      // 定义未变的车道保留结论；定义变化的车道按新哈希失效。
      if (entry && entry.laneHash === laneHash(lanes[i])) kept[lanes[i].id] = entry;
    }
    writeJson(stateFile("plan.json"), {
      baseCommit: resolvedBase,
      baseTree: git(["rev-parse", resolvedBase + "^{tree}"]),
      planHash: planHash(plan),
      normalizedPlan: stableStringify(plan),
      recordedAt: new Date().toISOString(),
    });
    saveVerdicts({ planHash: planHash(plan), lanes: kept });
    fs.rmSync(stateFile("proof.json"), { force: true });
    const dropped = Object.keys(previousVerdicts.lanes).filter(function (id) {
      return !kept[id];
    });
    note(
      "已记录计划：base=" +
        short(resolvedBase) +
        " planHash=" +
        short(planHash(plan)) +
        "（保留结论 " +
        Object.keys(kept).length +
        " 条，失效 " +
        dropped.length +
        " 条：" +
        dropped.join(", ") +
        "）",
    );
  });
}

function commandStatus() {
  const plan = loadPlan();
  const recorded = loadRecordedPlan();
  const verdicts = loadVerdicts();
  const current = candidate();
  const currentHash = planHash(plan);
  const lanes = plan.lanes || [];
  const effective = effectiveLanes(plan, verdicts, "HEAD");
  const lines = [];
  lines.push("候选：HEAD=" + short(current.head) + " tree=" + short(current.tree) + " 已跟踪未提交=" + current.dirty);
  lines.push(
    "计划：schema=" +
      String(plan.schema) +
      " 车道=" +
      lanes.length +
      (recorded ? " base=" + short(recorded.baseCommit) + " planHash=" + short(recorded.planHash) : " 未记录"),
  );
  if (!recorded) lines.push("  先用 pnpm run review:plan -- --base <commit> 记录计划");
  else if (recorded.planHash !== currentHash) lines.push("  计划内容已改变：先重新 review:plan");
  for (let i = 0; i < lanes.length; i += 1) {
    const state = effective.get(lanes[i].id);
    lines.push(
      "  车道 " +
        lanes[i].id +
        "：" +
        state.verdict +
        (state.effective ? " 有效" : " 无效（" + state.reason + "）") +
        " fingerprint=" +
        state.fingerprint,
    );
  }
  if (fs.existsSync(FINDINGS_PATH)) {
    const ledger = parseLedger(fs.readFileSync(FINDINGS_PATH, "utf8"));
    const unresolved = ledger.findings.filter(function (finding) {
      return finding.status === "unresolved";
    }).length;
    const problems = validateLedger(ledger);
    lines.push(
      "台账：" +
        String(ledger.ledgerStatus) +
        " findings=" +
        ledger.findings.length +
        " unresolved=" +
        unresolved +
        (problems.length ? " 结构问题=" + problems.length + "（" + problems[0] + "）" : ""),
    );
  } else {
    lines.push("台账：缺失（先 review:findings:new）");
  }
  const gate = loadGate();
  lines.push(
    "门禁：" +
      (gate
        ? gate.command + " exit=" + gate.exitCode + (gate.tree === current.tree ? " 与当前树一致" : " 与当前树不一致")
        : "未运行"),
  );
  const proof = loadProof();
  lines.push(
    "proof：" +
      (proof
        ? "head=" +
          short(proof.head) +
          " tree=" +
          short(proof.tree) +
          " 车道=" +
          Object.keys(proof.laneFingerprints || {}).length
        : "未生成"),
  );
  note(lines.join("\n"));
}

function commandLane(args) {
  const laneIndex = args.indexOf("--lane");
  const evidenceIndex = args.indexOf("--evidence");
  if (laneIndex < 0 || evidenceIndex < 0) fail("用法：pnpm run review:lane -- --lane <id> --evidence <report.md>");
  const laneId = args[laneIndex + 1];
  const evidencePath = args[evidenceIndex + 1];
  const plan = loadPlan();
  const recorded = loadRecordedPlan();
  if (!recorded) fail("计划尚未记录，先运行 pnpm run review:plan -- --base <commit>");
  if (recorded.planHash !== planHash(plan)) fail("计划内容已改变，先重新运行 review:plan");
  const lane = (plan.lanes || []).find(function (item) {
    return item.id === laneId;
  });
  if (!lane) fail("未知车道：" + laneId);
  if (!fs.existsSync(evidencePath)) fail("证据文件不存在：" + evidencePath);
  const report = fs.readFileSync(evidencePath, "utf8");
  const tail = report
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .pop();
  const verdictMatch = /^VERDICT:\s*(.+)$/.exec(tail || "");
  if (!verdictMatch) fail("证据报告最后一行必须是 VERDICT: ...");
  const verdict = verdictMatch[1].trim();
  if (VERDICT_VALUES.indexOf(verdict) < 0) fail("VERDICT 取值必须是 " + VERDICT_VALUES.join(" / "));
  const head = git(["rev-parse", "HEAD"]);
  const fingerprint = laneFingerprint(lane);
  const declaredFingerprint = /^FINGERPRINT:\s*(.+)$/m.exec(report);
  if (!declaredFingerprint) {
    fail("证据报告必须包含 FINGERPRINT: <该车道的 fingerprint> 行（先运行 pnpm run review:status 取值）");
  }
  if (declaredFingerprint[1].trim() !== fingerprint) {
    fail(
      "报告声明的 FINGERPRINT 与当前不一致（报告 " +
        declaredFingerprint[1].trim() +
        "，当前 " +
        fingerprint +
        "）：车道输入已变化",
    );
  }
  const declaredLane = /^LANE:\s*(.+)$/m.exec(report);
  if (!declaredLane) fail("证据报告必须包含 LANE: <车道 id> 行");
  if (declaredLane[1].trim() !== laneId) {
    fail("报告声明的 LANE（" + declaredLane[1].trim() + "）与记录的车道（" + laneId + "）不一致");
  }
  const declaredHead = /^HEAD:\s*(.+)$/m.exec(report);
  const reviewedHead = declaredHead ? declaredHead[1].trim() : null;
  // HEAD 只作来源记录：结论的权威绑定是车道定义哈希与输入指纹。不相关的提交不作废结论。
  if (reviewedHead && reviewedHead !== head) {
    note(
      "提示：报告完成于 " + short(reviewedHead) + "，当前候选 " + short(head) + "；车道定义与指纹一致时结论仍然有效。",
    );
  }
  return withLock(function () {
    const verdicts = loadVerdicts();
    verdicts.planHash = recorded.planHash;
    verdicts.lanes[laneId] = {
      verdict: verdict,
      fingerprint: fingerprint,
      laneHash: laneHash(lane),
      head: head,
      reviewedHead: reviewedHead,
      planHash: recorded.planHash,
      evidencePath: path.resolve(evidencePath),
      evidenceHash: sha256(report),
      recordedAt: new Date().toISOString(),
    };
    saveVerdicts(verdicts);
    fs.rmSync(stateFile("proof.json"), { force: true });
    note(
      "已记录车道 " +
        laneId +
        "：" +
        verdict +
        " fingerprint=" +
        fingerprint +
        (verdict === VERDICT_CLEAN ? "" : "（非 clean，会阻断 finalize）"),
    );
  });
}

/**
 * FORCE 路径（FFUI_CHECK_ALL_COALESCE_FORCE=1）在 check-all-coalesce.mjs 里只等待锁、不做死 owner 回收，
 * 残留锁会让门禁永不返回。这里按同一判据（pid 不存在且锁龄超过 30 秒）先清掉死锁。
 */
function clearStaleCheckAllLock() {
  const lockDir = path.join(ROOT, ".cache", "check-all", "coalesce", "check-all.lockdir");
  const ownerPath = path.join(lockDir, "owner.json");
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
  } catch {
    return; // 没有锁或读不到 owner：交给 coalesce 自己的路径处理
  }
  const pid = Number(owner && owner.pid);
  const startedAtMs = Number(owner && owner.startedAtMs);
  if (!Number.isInteger(pid) || pid <= 0) return;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = error && error.code;
    alive = !(code === "ESRCH" || code === "ENOENT"); // 只在确实不存在时判死
  }
  const ageMs = Date.now() - (Number.isFinite(startedAtMs) ? startedAtMs : 0);
  if (!alive && ageMs > 30_000) {
    fs.rmSync(lockDir, { recursive: true, force: true });
    note("review: 清掉了残留的 check:all 锁（owner pid " + pid + " 已不存在）");
  }
}

function commandGate() {
  ensureCleanWorktree("门禁");
  runSelftest();
  clearStaleCheckAllLock();
  const started = Date.now();
  // 强制真实执行：check:all 的复用缓存（.cache/check-all/coalesce/results/*.json）是本地未跟踪状态，
  // 其 exitCode 曾被直接当作门禁结果；这里绕过缓存，使记录到的退出码必然来自一次真实运行。
  const result = spawnSync(DEFAULT_GATE[0], DEFAULT_GATE.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: Object.assign({}, process.env, { FFUI_CHECK_ALL_COALESCE_FORCE: "1" }),
    // 最坏情况应是"失败"而不是"永不返回"：FORCE 路径不回收死锁，这里给命令设上限。
    timeout: 90 * 60 * 1000,
  });
  if (result.error && String(result.error.code) === "ETIMEDOUT") {
    fail("门禁命令 90 分钟未返回，可能卡在 check:all 的锁上；请检查 .cache/check-all/coalesce/check-all.lockdir");
  }
  const exitCode = typeof result.status === "number" ? result.status : 1;
  return withLock(function () {
    writeJson(stateFile("gate.json"), {
      command: GATE_COMMAND_LABEL,
      exitCode: exitCode,
      head: git(["rev-parse", "HEAD"]),
      tree: git(["rev-parse", "HEAD^{tree}"]),
      durationMs: Date.now() - started,
      recordedAt: new Date().toISOString(),
    });
    fs.rmSync(stateFile("proof.json"), { force: true });
    note("门禁：" + GATE_COMMAND_LABEL + " exit=" + exitCode);
  });
}

function commandFinalize() {
  ensureCleanWorktree("finalize");
  const plan = loadPlan();
  const recorded = loadRecordedPlan();
  if (!recorded) fail("计划尚未记录");
  // finalize 阶段放行「审阅下界等于 HEAD」：origin/main 会随自身推送前进到 HEAD。
  const recordedBaseIssue = baseProblemForCommand("finalize", plan, recorded.baseCommit);
  if (recordedBaseIssue) fail(recordedBaseIssue);
  const planProblems = validatePlanShape(plan, recorded.baseCommit);
  if (planProblems.length > 0) fail("计划无效：\n  " + planProblems.join("\n  "));
  const currentHash = planHash(plan);
  if (recorded.planHash !== currentHash) fail("计划内容已改变，先重新运行 review:plan");
  const verdicts = loadVerdicts();
  const current = candidate();
  const effective = effectiveLanes(plan, verdicts, "HEAD");
  const ineffective = [];
  const laneFingerprints = {};
  const laneHashes = {};
  for (let i = 0; i < (plan.lanes || []).length; i += 1) {
    const lane = plan.lanes[i];
    const state = effective.get(lane.id);
    laneFingerprints[lane.id] = laneFingerprint(lane, "HEAD");
    laneHashes[lane.id] = laneHash(lane);
    if (!state.effective) ineffective.push(lane.id + "(" + state.reason + ")");
  }
  if (ineffective.length > 0) fail("以下车道没有针对当前内容的有效 clean 结论：\n  " + ineffective.join("\n  "));
  const ledger = readLedger();
  const ledgerProblems = validateLedger(ledger);
  if (ledgerProblems.length > 0) fail("台账无效：\n  " + ledgerProblems.join("\n  "));
  const unresolved = unresolvedFindings(ledger);
  if (unresolved.length > 0) {
    fail(
      "仍有 " +
        unresolved.length +
        " 条 unresolved finding： " +
        unresolved
          .map(function (item) {
            return item.id;
          })
          .join(", "),
    );
  }
  const gate = loadGate();
  if (!gate) fail("尚未运行门禁：先 pnpm run review:gate");
  if (gate.command !== GATE_COMMAND_LABEL) fail("门禁记录的命令不是 " + GATE_COMMAND_LABEL);
  if (gate.exitCode !== 0) fail("门禁未通过（exit=" + gate.exitCode + "）");
  if (gate.tree !== current.tree) fail("门禁是针对另一棵树记录的，重新运行 pnpm run review:gate");
  const evidenceHashes = {};
  const ids = Object.keys(verdicts.lanes);
  for (let i = 0; i < ids.length; i += 1) evidenceHashes[ids[i]] = verdicts.lanes[ids[i]].evidenceHash;
  return withLock(function () {
    writeJson(stateFile("proof.json"), {
      planHash: currentHash,
      baseCommit: recorded.baseCommit,
      head: current.head,
      tree: current.tree,
      laneFingerprints: laneFingerprints,
      laneHashes: laneHashes,
      evidenceHashes: evidenceHashes,
      gate: { command: gate.command, exitCode: gate.exitCode, tree: gate.tree },
      ledgerStatus: ledger.ledgerStatus,
      finalizedAt: new Date().toISOString(),
    });
    note(
      "已生成 proof：head=" +
        short(current.head) +
        " tree=" +
        short(current.tree) +
        " 车道=" +
        Object.keys(laneFingerprints).length,
    );
  });
}

/** pre-push 的独立复核：计划、车道结论、台账、门禁与 proof 必须互相自洽。 */
function reviewStateRefusals(commit, tree) {
  const refusals = [];
  const plan = loadPlan();
  const proof = loadProof();
  const gate = loadGate();
  const verdicts = loadVerdicts();
  const recorded = loadRecordedPlan();
  if (!recorded) refusals.push("计划尚未记录");
  if (!proof) refusals.push("没有 review proof");
  if (!gate) refusals.push("没有门禁记录");
  if (!fs.existsSync(FINDINGS_PATH)) refusals.push("没有 findings 台账");
  if (refusals.length > 0) return refusals;
  if (recorded.planHash !== planHash(plan)) refusals.push("计划内容已改变，proof 失效");
  if (proof.planHash !== planHash(plan)) refusals.push("proof 绑定的计划哈希与当前计划不一致");
  const recordedBaseIssue = baseProblemForCommand("pre-push", plan, recorded.baseCommit);
  if (recordedBaseIssue) refusals.push(recordedBaseIssue);
  if (proof.tree !== tree) refusals.push("proof 绑定的树与被推送的树不一致");
  if (gate.tree !== tree) refusals.push("门禁记录的树与被推送的树不一致");
  if (gate.command !== GATE_COMMAND_LABEL) refusals.push("门禁记录的命令不是 " + GATE_COMMAND_LABEL);
  if (gate.exitCode !== 0) refusals.push("门禁未通过（exit=" + gate.exitCode + "）");
  const ledger = readLedger();
  const ledgerProblems = validateLedger(ledger);
  if (ledgerProblems.length > 0) refusals.push("台账无效：" + ledgerProblems[0]);
  const unresolvedIds = unresolvedFindings(ledger).map(function (item) {
    return item.id;
  });
  if (unresolvedIds.length > 0) refusals.push("仍有未终结 finding：" + unresolvedIds.join(", "));
  const drifted = [];
  for (let i = 0; i < (plan.lanes || []).length; i += 1) {
    const lane = plan.lanes[i];
    const entry = verdicts.lanes[lane.id];
    if (!entry) {
      drifted.push(lane.id + "(缺结论)");
      continue;
    }
    if (entry.verdict !== VERDICT_CLEAN) drifted.push(lane.id + "(" + entry.verdict + ")");
    else if (entry.laneHash !== laneHash(lane)) drifted.push(lane.id + "(车道定义已变)");
    else if (entry.fingerprint !== laneFingerprint(lane, commit)) drifted.push(lane.id + "(输入已变)");
    else if ((proof.laneFingerprints || {})[lane.id] !== entry.fingerprint) drifted.push(lane.id + "(proof 指纹不符)");
    else if ((proof.laneHashes || {})[lane.id] !== entry.laneHash) drifted.push(lane.id + "(proof 车道哈希不符)");
    else if (!entry.evidencePath || !fs.existsSync(entry.evidencePath)) drifted.push(lane.id + "(证据报告缺失)");
    else if (sha256(fs.readFileSync(entry.evidencePath, "utf8")) !== entry.evidenceHash)
      drifted.push(lane.id + "(证据报告被改写)");
    else if ((proof.evidenceHashes || {})[lane.id] !== entry.evidenceHash)
      drifted.push(lane.id + "(proof 证据哈希不符)");
  }
  if (drifted.length > 0) refusals.push("车道结论不成立：" + drifted.join(", "));
  return refusals;
}

function commandPrePush() {
  runSelftest();
  const input = fs.readFileSync(0, "utf8");
  const updates = input
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .map(function (line) {
      return line.split(/\s+/);
    });
  const zero = "0000000000000000000000000000000000000000";
  const refusals = [];
  for (let i = 0; i < updates.length; i += 1) {
    const localRef = updates[i][0];
    const localOid = updates[i][1];
    const branch = localRef.replace("refs/heads/", "").replace("refs/tags/", "");
    if (PROTECTED_LOCAL_BRANCHES.indexOf(branch) >= 0) {
      refusals.push("拒绝推送本地专用分支 " + branch);
      continue;
    }
    if (localOid === zero) continue;
    const commit = tryGit(["rev-parse", localOid + "^{commit}"]);
    if (!commit) {
      refusals.push(localRef + " 不是提交，无法校验");
      continue;
    }
    const tree = git(["rev-parse", commit + "^{tree}"]);
    const problems = reviewStateRefusals(commit, tree);
    for (let k = 0; k < problems.length; k += 1) refusals.push(localRef + "：" + problems[k]);
  }
  if (refusals.length > 0) {
    const guidance = [
      "review: 推送被拒绝（推送前独立 review 未通过，且无豁免）。",
      ...refusals.map(function (item) {
        return "  - " + item;
      }),
      "处理：确认 REVIEW_PLAN.json 的车道覆盖全部改动 → pnpm run review:plan -- --base origin/main",
      "      → 每条车道跑独立 review 并 pnpm run review:lane -- --lane <id> --evidence <报告>",
      "      → pnpm run review:gate → pnpm run review:finalize，然后重试推送。",
      "注意：本钩子是可绕过的本地流程门禁（git push --no-verify / HUSKY=0 会跳过）；绕过即表示未审内容被推送。",
    ];
    process.stderr.write(guidance.join("\n") + "\n");
    process.exit(1);
  }
  note("review: 推送前检查通过（计划、车道结论、台账、门禁与 proof 自洽）。");
}

/**
 * 生产接线的文本断言：finalize/pre-push 的放行行为无法在没有完整 proof/gate/verdicts 时端到端构造，
 * 因此这里对**本文件自身**断言三处调用点与阶段查表仍然存在。这是接线守卫，不是行为测试：
 * 把任一调用改成字面量、或把阶段映射从命令名查表改掉，都会让它失败。
 */
function selftestWiringText() {
  const source = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  // needle 必须拼接构造：若把期望文本整段写成字面量，indexOf 会命中它自己，断言就恒真。
  const expectedCall = function (command, baseExpression, variable) {
    return (
      "const " + variable + " = baseProblemForCommand(" + JSON.stringify(command) + ", plan, " + baseExpression + ");"
    );
  };
  const expectations = [
    ["const phase = " + "BASE_PHASE_BY_COMMAND[String(command)];", "阶段不再由命令名查表"],
    [expectedCall("plan", "resolvedBase", "baseIssue"), "记录计划未走 plan 阶段"],
    [expectedCall("finalize", "recorded.baseCommit", "recordedBaseIssue"), "finalize 未走 finalize 阶段"],
    [expectedCall("pre-push", "recorded.baseCommit", "recordedBaseIssue"), "pre-push 未走 pre-push 阶段"],
    ["phase: " + "phase,", "baseDecision 未收到阶段（透传被写死）"],
    ["baseCommit: " + "baseCommit,", "baseDecision 未收到所选 base（透传被写死）"],
    ["return baseProblem(plan, baseCommit, " + "basePhaseFor(command));", "命令→阶段的委派被改写"],
    ["if (recordedBaseIssue) " + "fail(recordedBaseIssue);", "finalize 消费了 base 判定结果这一行被删除或改写"],
    [
      "if (recordedBaseIssue) " + "refusals.push(recordedBaseIssue);",
      "pre-push 消费了 base 判定结果这一行被删除或改写",
    ],
  ];
  // 只匹配**真实语句行**（整行、行首缩进后可含结尾空白）：把 needle 留在注释或死代码里、
  // 而真实调用点被改写，必须失败。
  const statementLine = function (text) {
    const escaped = text.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
    return new RegExp("^[ \\t]*" + escaped + "[ \\t]*$", "gm");
  };
  const results = expectations.map(function (entry) {
    const matches = source.match(statementLine(entry[0])) || [];
    return [matches.length === 1, "生产接线缺失或重复（" + entry[1] + "）：期望恰好一条语句行匹配 " + entry[0]];
  });
  // 调用语句行总数必须恰好 3：把同一文本复制进不可达函数或模板字符串会多出语句行（注释行不算），
  // 「死代码或字符串里的副本不影响真实接线」这类说法因此可被机械检查。
  const declarations = source.match(/^[ \t]*const (baseIssue|recordedBaseIssue) = baseProblemForCommand\(/gm) || [];
  results.push([
    declarations.length === 3,
    "生产接线语句行应为 3 条（实际 " + declarations.length + " 条）：可能存在重复副本或死代码/字符串里的同一文本",
  ]);
  // 委派只能有一处：多插一条 `return baseProblem(...)` 覆盖阶段（而保留原行）会多出返回语句。
  const delegations = source.match(/^[ \t]*(?:if \(.*?\) )?return baseProblem\(/gm) || [];
  results.push([delegations.length === 1, "命令→阶段的委派语句应为 1 条（实际 " + delegations.length + " 条）"]);

  // 调用点的出现顺序必须与命令顺序一致：把 finalize/pre-push 的字面量互换会打乱顺序。
  const order = expectations.slice(1, 4).map(function (entry) {
    return source.indexOf(entry[0]);
  });
  results.push([
    order[0] >= 0 && order[0] < order[1] && order[1] < order[2],
    "调用点顺序与命令顺序不一致（plan/finalize/pre-push）：可能有字面量被互换",
  ]);
  // 行为性断言：映射函数本身（文本断言只能证明这些行存在）。
  results.push([
    basePhaseFor("plan") === "plan" &&
      basePhaseFor("finalize") === "finalize" &&
      basePhaseFor("pre-push") === "pre-push" &&
      requiresReviewable(basePhaseFor("plan")) &&
      !requiresReviewable(basePhaseFor("finalize")) &&
      !requiresReviewable(basePhaseFor("pre-push")),
    "命令→阶段的行为性断言失败（basePhaseFor 或阶段策略被改）",
  ]);
  return results;
}

/**
 * 端到端接线自检：在一次性 git 仓库里跑真实 CLI，确认「记录计划时拒绝退化 base」这条
 * 生产路径真的生效。纯函数断言覆盖不到命令接线与阶段字面量，这里补上。
 */
function selftestWiringChecks() {
  const checks = [];
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffui-review-selftest-"));
    fs.writeFileSync(path.join(dir, "empty-gitconfig"), "");
  } catch (error) {
    return [[false, "端到端接线自检无法准备临时目录：" + String(error && error.message ? error.message : error)]];
  }
  // 隔离宿主 git 配置：commit.gpgsign / core.hooksPath / init.templateDir 等会让 fixture 提交失败，
  // 而 gate 与 pre-push 每次都会跑这段自检。
  const emptyConfig = path.join(dir, "empty-gitconfig");
  const gitEnv = Object.assign({}, process.env, {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
  });
  const git = function (args) {
    return spawnSync(
      "git",
      ["-C", dir, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=", "-c", "init.templateDir="].concat(args),
      { encoding: "utf8", env: gitEnv },
    );
  };
  const mustGit = function (args) {
    const result = git(args);
    if (result.status !== 0) {
      checks.push([false, "端到端接线自检的 git 步骤失败：" + args.join(" ") + "：" + text(result).trim()]);
    }
    return result;
  };
  const run = function (args) {
    return spawnSync(process.execPath, [path.join(dir, "scripts", "review.mjs")].concat(args), {
      cwd: dir,
      encoding: "utf8",
    });
  };
  const text = function (result) {
    return String(result.stdout || "") + String(result.stderr || "");
  };
  try {
    mustGit(["init", "-q"]);
    mustGit(["config", "user.email", "selftest@example.invalid"]);
    mustGit(["config", "user.name", "review selftest"]);
    fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
    mustGit(["add", "a.txt"]);
    mustGit(["commit", "-q", "-m", "one"]);
    const firstResult = git(["rev-parse", "HEAD"]);
    const first = String(firstResult.stdout || "").trim();
    if (firstResult.status !== 0 || !first) {
      checks.push([false, "端到端接线自检：无法取得 fixture 的第一个提交"]);
    }
    fs.writeFileSync(path.join(dir, "a.txt"), "two\n");
    mustGit(["add", "a.txt"]);
    mustGit(["commit", "-q", "-m", "two"]);
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.copyFileSync(fileURLToPath(import.meta.url), path.join(dir, "scripts", "review.mjs"));
    writeJson(path.join(dir, "REVIEW_PLAN.json"), {
      schema: PLAN_SCHEMA,
      obligations: [{ id: "test-coverage", description: "d", disposition: "covered", reason: null }],
      lanes: [
        {
          id: "l",
          scope: "s",
          paths: ["a.txt"],
          dependsOn: [],
          obligations: ["test-coverage"],
          owners: ["o"],
          consumers: ["c"],
          counterexamples: ["x"],
        },
      ],
    });
    mustGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const degenerate = run(["plan", "--base", "HEAD"]);
    checks.push([
      degenerate.status !== 0 && text(degenerate).indexOf("base 等于 HEAD") >= 0,
      "端到端：base 等于 HEAD（区间为空）时仍记录了计划",
    ]);
    // origin/main 已前进到 HEAD 时，用更早的 base 重录计划必须被接受（区间非空）。
    const olderBase = run(["plan", "--base", first]);
    checks.push([olderBase.status === 0, "端到端：origin/main 等于 HEAD 时用更早 base 重录计划被误拒"]);
    mustGit(["update-ref", "refs/remotes/origin/main", first]);
    const normal = run(["plan", "--base", first]);
    checks.push([normal.status === 0, "端到端：非退化状态下记录计划被误拒"]);
  } catch (error) {
    checks.push([false, "端到端接线自检无法完成：" + String(error && error.message ? error.message : error)]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return checks;
}

/** 门禁引擎自身的自检：确认纯函数的关键不变量成立。 */
export function selftestProblems() {
  const lane = {
    id: "l",
    paths: ["a.txt"],
    scope: "s",
    owners: ["o"],
    consumers: ["c"],
    counterexamples: ["x"],
    obligations: [],
  };
  const ledger = parseLedger(
    "---\nschema: " +
      FINDINGS_SCHEMA +
      "\nledgerStatus: open\nfindings:\n  - id: F001\n    severity: P1\n    status: unresolved\n    owner: o\n    condition: c\n    impact: i\n    requiredOutcome: r\n---\n",
  );
  const checks = [
    [
      laneFingerprint(lane, "HEAD") !== laneFingerprint({ ...lane, paths: ["b.txt"] }, "HEAD"),
      "车道指纹对路径变化不敏感",
    ],
    [laneHash(lane) !== laneHash({ ...lane, scope: "s2" }), "车道哈希对定义变化不敏感"],
    [stableStringify({ b: 1, a: 2 }) === stableStringify({ a: 2, b: 1 }), "稳定序列化对键序敏感"],
    [ledger.findings.length === 1, "台账解析未读到 finding"],
    [validateLedger(ledger).length === 0, "台账结构校验误拒 open + unresolved"],
    [unresolvedFindings(ledger).length === 1, "未终结 finding 计数不正确"],
    [
      validateLedger({ schema: FINDINGS_SCHEMA, ledgerStatus: "resolved", findings: [] }).length === 0,
      "台账校验误拒空台账",
    ],
    [validateLedger({ schema: "wrong", ledgerStatus: "resolved", findings: [] }).length !== 0, "台账校验未检查 schema"],
    [validatePlanShape({ schema: PLAN_SCHEMA, obligations: [], lanes: [] }, null).length !== 0, "计划校验未拒绝空计划"],
    [
      parseLedger(
        "---\nschema: " +
          FINDINGS_SCHEMA +
          "\nledgerStatus: open\nfindings:\n  - id: F001\n    severity: P1\n    status: unresolved\n    owner: o\n    condition: >-\n      status: invalid\n    impact: i\n    requiredOutcome: r\n---\n",
      ).findings[0].status === "unresolved",
      "块标量正文覆盖了顶层 status",
    ],
    [
      parseLedger(
        "---\nschema: " +
          FINDINGS_SCHEMA +
          "\nledgerStatus: open\nfindings:\n  - id: F001\n    severity: P1\n    status: unresolved\n    owner: o\n    condition: >-\n      - looks like a bullet\n    impact: i\n    requiredOutcome: r\n---\n",
      ).findings.length === 1,
      "块标量正文被当成新的 finding",
    ],
    [
      requiresReviewable("plan") && !requiresReviewable("finalize") && !requiresReviewable("pre-push"),
      "阶段策略：只有记录计划要求存在可审差异",
    ],
    [
      baseDecision({
        ancestorOfHead: true,
        head: "h",
        reference: "origin/main",
        referenceCommit: "r",
        mergeBase: "h",
        baseCommit: "h",
        phase: "plan",
      }) !== null,
      "记录计划时未拒绝退化的审阅下界",
    ],
    [
      baseDecision({
        ancestorOfHead: true,
        head: "h",
        reference: "origin/main",
        referenceCommit: "r",
        mergeBase: "h",
        baseCommit: "h",
        phase: "finalize",
      }) === null,
      "finalize/pre-push 误拒「远端基线已包含 HEAD」的情况",
    ],
    [
      baseDecision({
        ancestorOfHead: false,
        head: "h",
        reference: "origin/main",
        referenceCommit: "r",
        mergeBase: "m",
        phase: "finalize",
        shortBase: "b",
      }) !== null,
      "非祖先 base 未被拒绝",
    ],
    [
      baseDecision({
        ancestorOfHead: true,
        head: "h",
        reference: "origin/main",
        referenceCommit: "r",
        mergeBase: "m",
        phase: "finalize",
        baseAncestorOfMergeBase: false,
        shortMergeBase: "m",
      }) !== null,
      "晚于 merge-base 的 base 未被拒绝",
    ],
    [
      baseDecision({
        ancestorOfHead: true,
        head: "h",
        baseCommit: "b",
        reference: "origin/main",
        referenceCommit: "r",
        mergeBase: "h",
        phase: "plan",
        shortBase: "b",
      }) === null,
      "origin/main 已等于 HEAD 时，用更早的 base 重录计划被误拒（区间非空）",
    ],
    [
      BASE_PHASE_BY_COMMAND.plan === "plan" &&
        BASE_PHASE_BY_COMMAND.finalize === "finalize" &&
        BASE_PHASE_BY_COMMAND["pre-push"] === "pre-push" &&
        requiresReviewable(BASE_PHASE_BY_COMMAND.plan) &&
        !requiresReviewable(BASE_PHASE_BY_COMMAND.finalize) &&
        !requiresReviewable(BASE_PHASE_BY_COMMAND["pre-push"]),
      "命令→阶段接线与阶段策略不一致（这条是生产接线，不是纯函数）",
    ],
  ];
  checks.push(...selftestWiringText());
  checks.push(...selftestWiringChecks());
  return {
    problems: checks
      .filter(function (check) {
        return !check[0];
      })
      .map(function (check) {
        return check[1];
      }),
    checks: checks.length,
  };
}

function runSelftest() {
  const result = selftestProblems();
  if (result.problems.length > 0) {
    fail("门禁引擎自检失败（先修 scripts/review.mjs）：\n  " + result.problems.join("\n  "));
  }
}

function commandSelftest() {
  const result = selftestProblems();
  note(
    "自检：检查 " +
      result.checks +
      " 项不变量，" +
      (result.problems.length === 0
        ? "全部通过"
        : "失败 " + result.problems.length + " 项\n  " + result.problems.join("\n  ")),
  );
  if (result.problems.length > 0) process.exit(1);
}

const COMMANDS = {
  "plan:new": commandPlanNew,
  "findings:new": commandFindingsNew,
  plan: commandPlan,
  status: commandStatus,
  lane: commandLane,
  gate: commandGate,
  finalize: commandFinalize,
  selftest: commandSelftest,
  "pre-push": commandPrePush,
};

function usage() {
  note(
    [
      "用法：node scripts/review.mjs <command>",
      "  plan:new [--force]                    从模板创建 REVIEW_PLAN.json",
      "  findings:new [--force]                从模板创建 REVIEW_FINDINGS.md",
      "  plan --base <commit>                  记录计划；仅作废定义变化的车道结论",
      "  status                                打印候选、车道结论、台账、门禁与 proof 状态",
      "  lane --lane <id> --evidence <file>    记录一条车道的独立 review 结论",
      "  gate                                  对已跟踪文件干净的工作树运行 " + GATE_COMMAND_LABEL + " 并记录",
      "  finalize                              绑定计划、车道哈希/指纹、台账与门禁，生成 proof",
      "  selftest                              检查门禁引擎自身的不变量",
      "  pre-push                              pre-push 钩子入口（先自检，再复核全部状态）",
    ].join("\n"),
  );
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) fail("未知命令：" + command);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  handler(argv.slice(1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
