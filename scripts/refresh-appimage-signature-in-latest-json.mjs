#!/usr/bin/env node
// 把刚重签好的 AppImage 签名写回 latest.json 里指向它的平台条目。
//
// 就地填充 .upd_info 发生在 tauri-action 签名之后，所以 AppImage 的字节、它的 .sig，
// 以及 latest.json 里的 signature 必须一起重建；漏掉任何一处，应用内更新都会在
// minisign 校验处失败（这是静默失效：门禁不查就没人会发现）。
//
// 用法：node scripts/refresh-appimage-signature-in-latest-json.mjs <latest.json> <AppImage> <AppImage.sig>
import fs from "node:fs";
import path from "node:path";

const [, , latestJsonPath, appImagePath, signaturePath] = process.argv;
if (!latestJsonPath || !appImagePath || !signaturePath) {
  console.error("usage: refresh-appimage-signature-in-latest-json.mjs <latest.json> <AppImage> <AppImage.sig>");
  process.exit(1);
}

const latest = JSON.parse(fs.readFileSync(latestJsonPath, "utf8"));
const signature = fs.readFileSync(signaturePath, "utf8").trim();
if (!signature) {
  console.error(`empty signature file: ${signaturePath}`);
  process.exit(1);
}

const appImageName = path.basename(appImagePath);
const platforms = latest.platforms ?? {};
const updated = [];
for (const [target, entry] of Object.entries(platforms)) {
  if (!entry || typeof entry !== "object") continue;
  const url = typeof entry.url === "string" ? entry.url : "";
  if (path.basename(url.split("?")[0]) !== appImageName) continue;
  entry.signature = signature;
  updated.push(target);
}

if (updated.length === 0) {
  // 改名/换布局会让这里失配：此时必须响亮失败，而不是发布一份签名对不上的更新清单。
  console.error(`no latest.json platform entry points at ${appImageName}`);
  process.exit(1);
}

fs.writeFileSync(latestJsonPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`updated latest.json signature for: ${updated.join(", ")}`);
