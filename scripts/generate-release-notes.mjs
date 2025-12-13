#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function usageAndExit() {
  // Keep output concise; this tool is primarily used in CI.
  // eslint-disable-next-line no-console
  console.error("Usage: node scripts/generate-release-notes.mjs <currentTag> [previousTag]");
  process.exit(2);
}

function normalizeTag(tag) {
  if (!tag) return "";
  return tag.trim();
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

function buildNotes({ repo, currentTag, previousTag, subjects }) {
  const groups = new Map();
  for (const subject of subjects) {
    const type = commitType(subject);
    const section = sectionForType(type);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(subject);
  }

  const orderedSections = [
    "Features",
    "Fixes",
    "Performance",
    "Refactors",
    "Docs",
    "Tests",
    "CI",
    "Chores",
    "Other",
  ];

  const lines = [];
  lines.push(`# FFUI ${currentTag}`);
  lines.push("");

  const compareUrl =
    previousTag && repo
      ? `https://github.com/${repo}/compare/${previousTag}...${currentTag}`
      : "";

  if (compareUrl) {
    lines.push(`Full Changelog: ${compareUrl}`);
    lines.push("");
  }

  for (const section of orderedSections) {
    const items = groups.get(section);
    if (!items || items.length === 0) continue;
    lines.push(`## ${section}`);
    for (const subject of items) {
      lines.push(`- ${subject}`);
    }
    lines.push("");
  }

  // Trim trailing blank lines for clean Action output.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

const currentTag = normalizeTag(process.argv[2]);
if (!currentTag) usageAndExit();

let previousTag = normalizeTag(process.argv[3] || "");
if (!previousTag) previousTag = pickPreviousTag(currentTag);

const range = previousTag ? `${previousTag}..${currentTag}` : currentTag;

// Use only the subject lines; this keeps release notes readable and consistent.
const subjects = runGit(["log", "--pretty=%s", range])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .filter((line) => !/^merge:/i.test(line));

const repo = process.env.GITHUB_REPOSITORY || "";
const notes = buildNotes({ repo, currentTag, previousTag, subjects });

// eslint-disable-next-line no-console
console.log(notes);

