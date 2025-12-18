#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function usageAndExit() {
  // Keep output concise; this tool is primarily used in CI.
  // eslint-disable-next-line no-console
  console.error("Usage: node scripts/generate-release-notes.mjs <currentTag> [previousTag] [--format=bilingual|plain]");
  process.exit(2);
}

function normalizeTag(tag) {
  if (!tag) return "";
  return tag.trim();
}

function parseFormat(argv) {
  const formatArg = argv.find((arg) => arg.startsWith("--format="));
  if (!formatArg) return "bilingual";
  const value = formatArg.slice("--format=".length).trim();
  if (value === "plain" || value === "bilingual") return value;
  return "bilingual";
}

function groupSubjects(subjects) {
  const groups = new Map();
  for (const subject of subjects) {
    const type = commitType(subject);
    const section = sectionForType(type);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(subject);
  }
  return groups;
}

function renderGroupedSections(groups, orderedSections, titleMapper, headingLevel) {
  const lines = [];
  for (const section of orderedSections) {
    const items = groups.get(section);
    if (!items || items.length === 0) continue;
    const title = titleMapper(section);
    lines.push(`${headingLevel} ${title}`);
    for (const subject of items) {
      lines.push(`- ${subject}`);
    }
    lines.push("");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function pickPreviousTag(currentTag) {
  const tags = runGit(["tag", "--list", "v*", "--sort=-version:refname"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const tag of tags) {
    if (tag !== currentTag) return tag;
  }
  return "";
}

function commitType(subject) {
  const match = subject.match(/^([a-zA-Z]+)(\(.+\))?!?:\s+/);
  if (!match) return "other";
  return match[1].toLowerCase();
}

function sectionForType(type) {
  if (type === "feat") return "Features";
  if (type === "fix") return "Fixes";
  if (type === "perf") return "Performance";
  if (type === "refactor") return "Refactors";
  if (type === "ci") return "CI";
  if (type === "docs") return "Docs";
  if (type === "test") return "Tests";
  if (type === "chore") return "Chores";
  return "Other";
}

function zhSectionForEn(enSection) {
  if (enSection === "Features") return "新增";
  if (enSection === "Fixes") return "修复";
  if (enSection === "Performance") return "性能";
  if (enSection === "Refactors") return "重构";
  if (enSection === "Docs") return "文档";
  if (enSection === "Tests") return "测试";
  if (enSection === "CI") return "CI";
  if (enSection === "Chores") return "杂项";
  return "其他";
}

function buildNotesPlain({ repo, currentTag, previousTag, subjects }) {
  const groups = groupSubjects(subjects);

  const orderedSections = ["Features", "Fixes", "Performance", "Refactors", "Docs", "Tests", "CI", "Chores", "Other"];

  const lines = [];
  lines.push(`# FFUI ${currentTag}`);
  lines.push("");

  const compareUrl = previousTag && repo ? `https://github.com/${repo}/compare/${previousTag}...${currentTag}` : "";

  if (compareUrl) {
    lines.push(`Full Changelog: ${compareUrl}`);
    lines.push("");
  }

  lines.push(...renderGroupedSections(groups, orderedSections, (s) => s, "##"));

  // Trim trailing blank lines for clean Action output.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function buildNotesBilingual({ repo, currentTag, previousTag, subjects }) {
  const compareUrl = previousTag && repo ? `https://github.com/${repo}/compare/${previousTag}...${currentTag}` : "";

  const groups = groupSubjects(subjects);
  const orderedSections = ["Features", "Fixes", "Performance", "Refactors", "Docs", "Tests", "CI", "Chores", "Other"];

  const lines = [];
  lines.push(`# FFUI ${currentTag}`);
  lines.push("");

  if (compareUrl) {
    lines.push(`Full Changelog: ${compareUrl}`);
    lines.push("");
  }

  lines.push("## English");
  lines.push("");
  lines.push("<!-- Replace this draft with user-facing release notes. -->");
  lines.push("");
  lines.push(...renderGroupedSections(groups, orderedSections, (s) => s, "###"));
  lines.push("");

  lines.push("## 中文");
  lines.push("");
  lines.push("<!-- 请将下方草稿改写为面向用户的发布说明（与英文内容一致）。 -->");
  lines.push("");

  lines.push(...renderGroupedSections(groups, orderedSections, zhSectionForEn, "###"));

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

const argv = process.argv.slice(2);
const positional = argv.filter((arg) => !arg.startsWith("--"));
const currentTag = normalizeTag(positional[0]);
if (!currentTag) usageAndExit();

const format = parseFormat(argv);

let previousTag = normalizeTag(positional[1] || "");
if (!previousTag) previousTag = pickPreviousTag(currentTag);

const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;

// Use only the subject lines; this keeps release notes readable and consistent.
const subjects = runGit(["log", "--pretty=%s", range])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .filter((line) => !/^merge:/i.test(line));

const repo = process.env.GITHUB_REPOSITORY || "";
const notes =
  format === "plain"
    ? buildNotesPlain({ repo, currentTag, previousTag, subjects })
    : buildNotesBilingual({ repo, currentTag, previousTag, subjects });

// eslint-disable-next-line no-console
console.log(notes);
