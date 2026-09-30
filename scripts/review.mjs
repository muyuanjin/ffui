#!/usr/bin/env node
// 推送前独立 review 的门禁引擎。
//
// 契约：
// - REVIEW_PLAN.json（checkout-local，永不提交）是唯一有效的计划来源：按语义职责划分车道，
//   每个车道声明 scope/paths/obligations/owners/consumers/counterexamples。
// - REVIEW_FINDINGS.md（checkout-local，永不提交）是 findings 台账。
// - 车道结论绑定「该车道 paths 在候选提交上的内容指纹」与计划哈希；输入变化即失效。
// - proof 只在 finalize 生成，绑定计划哈希、候选提交/树、车道指纹、证据哈希与门禁结果。
// - pre-push 钩子拒绝没有有效 proof 的推送，并拒绝推送本地专用分支。
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
// 本地专用分支：只存在于本机，永远不推送。
export const PROTECTED_LOCAL_BRANCHES = ["caption-collage"];
const VERDICT_CLEAN = "NO FINDINGS";

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function short(hash) {
  return String(hash).slice(0, 16);
}

/** 递归按键排序后序列化，使计划哈希只反映语义内容。 */
export function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys
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

function ensureCleanWorktree(action) {
  // 只检查已跟踪文件的未提交变更：proof 与车道指纹都绑定提交树，未跟踪的本地产物不会进入推送。
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]).split("\n").filter(Boolean);
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
    dirty: git(["status", "--porcelain"]).split("\n").filter(Boolean).length,
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
    const textual = ["scope"];
    for (let k = 0; k < textual.length; k += 1) {
      if (!String(lane[textual[k]] || "").trim()) problems.push("lane " + label + " 缺少 " + textual[k]);
    }
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
          return (
            input === "." ||
            file === input ||
            file.indexOf(input.charAt(input.length - 1) === "/" ? input : input + "/") === 0
          );
        });
      });
      if (!covered) problems.push("变更路径未被任何车道覆盖：" + file);
    }
  }
  return problems;
}

/** 解析台账 front matter：ledgerStatus 与 findings 结构。 */
export function parseLedger(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { ledgerStatus: null, findings: [], error: "缺少 YAML front matter" };
  const lines = match[1].split(/\r?\n/);
  const findings = [];
  let current = null;
  let pendingKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const idMatch = /^\s*-\s+id:\s*(.*)$/.exec(line);
    if (idMatch) {
      current = { id: idMatch[1].trim() };
      findings.push(current);
      pendingKey = null;
      continue;
    }
    const fieldMatch = /^\s+([A-Za-z]+):\s*(.*)$/.exec(line);
    if (fieldMatch && current) {
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
  const ledgerStatus = /^ledgerStatus:\s*(.*)$/m.exec(match[1]);
  return { ledgerStatus: ledgerStatus ? ledgerStatus[1].trim() : null, findings: findings };
}

export function validateLedger(ledger) {
  const problems = [];
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

function readLedger() {
  if (!fs.existsSync(FINDINGS_PATH)) {
    fail("缺少 REVIEW_FINDINGS.md。先运行 pnpm run review:findings:new。");
  }
  return parseLedger(fs.readFileSync(FINDINGS_PATH, "utf8"));
}

/** 车道有效性：自身 clean 且指纹未变，且依赖闭包内全部有效。 */
function effectiveLanes(plan, verdicts, revision) {
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
    const entry = verdicts.lanes[id];
    let result = { effective: false, reason: "没有结论", fingerprint: fingerprint, verdict: "missing" };
    if (entry) {
      result.verdict = entry.verdict;
      result.evidencePath = entry.evidencePath;
      if (entry.verdict !== VERDICT_CLEAN) {
        result.reason = "结论为 " + entry.verdict;
      } else if (entry.planHash !== planHash(plan)) {
        result.reason = "计划已改变";
      } else if (entry.fingerprint !== fingerprint) {
        result.reason = "输入内容已变化";
      } else {
        const deps = lane.dependsOn || [];
        let blockedBy = null;
        for (let i = 0; i < deps.length; i += 1) {
          const upstream = visit(deps[i], stack.concat([id]));
          if (!upstream.effective) blockedBy = deps[i];
        }
        if (blockedBy) {
          result.reason = "上游车道无效：" + blockedBy;
        } else {
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
  process.stdout.write("已创建 " + PLAN_PATH + "\n");
}

function commandFindingsNew(args) {
  if (fs.existsSync(FINDINGS_PATH) && args.indexOf("--force") < 0)
    fail("REVIEW_FINDINGS.md 已存在（要覆盖加 --force）");
  fs.copyFileSync(path.join(TEMPLATE_DIR, "REVIEW_FINDINGS.md"), FINDINGS_PATH);
  process.stdout.write("已创建 " + FINDINGS_PATH + "\n");
}

function commandPlan(args) {
  const baseIndex = args.indexOf("--base");
  const plan = loadPlan();
  const previous = loadRecordedPlan();
  const baseRef = (baseIndex >= 0 ? args[baseIndex + 1] : null) || (previous && previous.baseCommit) || "HEAD~1";
  const resolvedBase = git(["rev-parse", baseRef + "^{commit}"]);
  const problems = validatePlanShape(plan, resolvedBase);
  if (problems.length > 0) fail("计划无效：\n  " + problems.join("\n  "));
  return withLock(function () {
    writeJson(stateFile("plan.json"), {
      baseCommit: resolvedBase,
      baseTree: git(["rev-parse", resolvedBase + "^{tree}"]),
      planHash: planHash(plan),
      normalizedPlan: stableStringify(plan),
      recordedAt: new Date().toISOString(),
    });
    saveVerdicts({ planHash: planHash(plan), lanes: {} });
    fs.rmSync(stateFile("proof.json"), { force: true });
    process.stdout.write(
      "已记录计划：base=" + short(resolvedBase) + " planHash=" + short(planHash(plan)) + "（旧结论已失效）\n",
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
  lines.push("候选：HEAD=" + short(current.head) + " tree=" + short(current.tree) + " 未提交=" + current.dirty);
  lines.push(
    "计划：schema=" +
      String(plan.schema) +
      " 车道=" +
      lanes.length +
      (recorded ? " base=" + short(recorded.baseCommit) + " planHash=" + short(recorded.planHash) : " 未记录"),
  );
  if (!recorded) lines.push("  先用 pnpm run review:plan -- --base <commit> 记录计划");
  else if (recorded.planHash !== currentHash) lines.push("  计划内容已改变：旧结论全部失效，需重新 review:plan");
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
        (problems.length ? " 结构问题=" + problems.length : ""),
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
  process.stdout.write(lines.join("\n") + "\n");
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
  const head = git(["rev-parse", "HEAD"]);
  const fingerprint = laneFingerprint(lane);
  const declaredHead = /^HEAD:\s*(.+)$/m.exec(report);
  const reviewedHead = declaredHead ? declaredHead[1].trim() : null;
  // HEAD 只作来源记录：结论的权威绑定是车道输入指纹（下方校验）与计划哈希。
  // 不相关的提交不应作废某条车道的结论，否则每次提交都要重跑全部门禁。
  if (reviewedHead && reviewedHead !== head) {
    process.stdout.write(
      "提示：报告完成于 " + short(reviewedHead) + "，当前候选 " + short(head) + "；车道指纹一致时结论仍然有效。\n",
    );
  }
  const declaredFingerprint = /^FINGERPRINT:\s*(.+)$/m.exec(report);
  if (declaredFingerprint && declaredFingerprint[1].trim() !== fingerprint) {
    fail(
      "报告声明的 FINGERPRINT 与当前不一致（报告 " +
        declaredFingerprint[1].trim() +
        "，当前 " +
        fingerprint +
        "）：车道输入已变化",
    );
  }
  return withLock(function () {
    const verdicts = loadVerdicts();
    verdicts.planHash = recorded.planHash;
    verdicts.lanes[laneId] = {
      verdict: verdict,
      fingerprint: fingerprint,
      head: head,
      reviewedHead: reviewedHead,
      planHash: recorded.planHash,
      evidencePath: path.resolve(evidencePath),
      evidenceHash: sha256(report),
      recordedAt: new Date().toISOString(),
    };
    saveVerdicts(verdicts);
    fs.rmSync(stateFile("proof.json"), { force: true });
    process.stdout.write(
      "已记录车道 " +
        laneId +
        "：" +
        verdict +
        " fingerprint=" +
        fingerprint +
        (verdict === VERDICT_CLEAN ? "" : "（非 clean，会阻断 finalize）") +
        "\n",
    );
  });
}

function commandGate(args) {
  const command = args.length > 0 ? args : DEFAULT_GATE;
  ensureCleanWorktree("门禁");
  const started = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  return withLock(function () {
    writeJson(stateFile("gate.json"), {
      command: command.join(" "),
      exitCode: exitCode,
      head: git(["rev-parse", "HEAD"]),
      tree: git(["rev-parse", "HEAD^{tree}"]),
      durationMs: Date.now() - started,
      recordedAt: new Date().toISOString(),
    });
    fs.rmSync(stateFile("proof.json"), { force: true });
    process.stdout.write("门禁：" + command.join(" ") + " exit=" + exitCode + "\n");
  });
}

function commandFinalize() {
  ensureCleanWorktree("finalize");
  const plan = loadPlan();
  const recorded = loadRecordedPlan();
  if (!recorded) fail("计划尚未记录");
  const planProblems = validatePlanShape(plan, recorded.baseCommit);
  if (planProblems.length > 0) fail("计划无效：\n  " + planProblems.join("\n  "));
  const currentHash = planHash(plan);
  if (recorded.planHash !== currentHash) fail("计划内容已改变，先重新运行 review:plan");
  const verdicts = loadVerdicts();
  const current = candidate();
  const effective = effectiveLanes(plan, verdicts, "HEAD");
  const ineffective = [];
  const laneFingerprints = {};
  for (let i = 0; i < (plan.lanes || []).length; i += 1) {
    const lane = plan.lanes[i];
    const state = effective.get(lane.id);
    laneFingerprints[lane.id] = laneFingerprint(lane, "HEAD");
    if (!state.effective) ineffective.push(lane.id + "(" + state.reason + ")");
  }
  if (ineffective.length > 0) fail("以下车道没有针对当前内容的有效 clean 结论：\n  " + ineffective.join("\n  "));
  const ledger = readLedger();
  const ledgerProblems = validateLedger(ledger);
  if (ledgerProblems.length > 0) fail("台账无效：\n  " + ledgerProblems.join("\n  "));
  const gate = loadGate();
  if (!gate) fail("尚未运行门禁：先 pnpm run review:gate");
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
      evidenceHashes: evidenceHashes,
      gate: { command: gate.command, exitCode: gate.exitCode, tree: gate.tree },
      ledgerStatus: ledger.ledgerStatus,
      finalizedAt: new Date().toISOString(),
    });
    process.stdout.write(
      "已生成 proof：head=" +
        short(current.head) +
        " tree=" +
        short(current.tree) +
        " 车道=" +
        Object.keys(laneFingerprints).length +
        "\n",
    );
  });
}

function commandPrePush() {
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
    const proof = loadProof();
    if (!proof) {
      refusals.push(localRef + " 没有 review proof");
      continue;
    }
    if (proof.tree !== tree) {
      refusals.push(localRef + " 的树 " + short(tree) + " 与 proof 绑定的树 " + short(proof.tree) + " 不一致");
      continue;
    }
    const plan = loadPlan();
    if (planHash(plan) !== proof.planHash) {
      refusals.push("计划内容已改变，proof 失效");
      continue;
    }
    const drifted = [];
    for (let k = 0; k < (plan.lanes || []).length; k += 1) {
      const lane = plan.lanes[k];
      const expected = (proof.laneFingerprints || {})[lane.id];
      if (laneFingerprint(lane, commit) !== expected) drifted.push(lane.id);
    }
    if (drifted.length > 0) refusals.push("以下车道的输入在被推送的提交上已变化：" + drifted.join(", "));
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
    ];
    process.stderr.write(guidance.join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write("review: 推送前检查通过（proof 与计划、车道指纹、门禁一致）。\n");
}

const COMMANDS = {
  "plan:new": commandPlanNew,
  "findings:new": commandFindingsNew,
  plan: commandPlan,
  status: commandStatus,
  lane: commandLane,
  gate: commandGate,
  finalize: commandFinalize,
  "pre-push": commandPrePush,
};

function usage() {
  process.stdout.write(
    [
      "用法：node scripts/review.mjs <command>",
      "  plan:new [--force]                    从模板创建 REVIEW_PLAN.json",
      "  findings:new [--force]                从模板创建 REVIEW_FINDINGS.md",
      "  plan --base <commit>                  记录计划并让旧结论失效",
      "  status                                打印候选、车道结论、台账、门禁与 proof 状态",
      "  lane --lane <id> --evidence <file>    记录一条车道的独立 review 结论",
      "  gate [<cmd> ...]                      对干净工作树运行门禁并记录（默认 pnpm run check:all）",
      "  finalize                              绑定计划、车道指纹、台账与门禁，生成 proof",
      "  pre-push                              pre-push 钩子入口",
    ].join("\n") + "\n",
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
