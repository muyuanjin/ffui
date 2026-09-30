#!/usr/bin/env node
// 校验 Tauri 更新签名（.sig）与 AppImage 字节是否相符。
//
// 签名格式：`.sig` 是 base64(minisign 签名文件)，解码后第二行是
// base64(2 字节算法前缀 + 8 字节 key id + 64 字节 Ed25519 签名)。
// 公钥来自 Tauri 配置：base64 之后是一个 minisign 公钥文件（首行注释 + base64 密钥行），
// 再解码得到 2 + 8 + 32 字节。
//
// 用 Node 的 Ed25519 校验，不依赖某个发行版是否打包了 minisign 命令行工具。
import crypto from "node:crypto";
import fs from "node:fs";

const [, , imagePath, sigPath, pubkeyBase64] = process.argv;
if (!imagePath || !sigPath || !pubkeyBase64) {
  console.error("usage: verify-tauri-appimage-signature.mjs <AppImage> <sig> <updater-pubkey-base64>");
  process.exit(2);
}

/** 从 Tauri 配置里的 pubkey 取出 42 字节的 minisign 公钥。 */
function readUpdaterPublicKey(encoded) {
  const decoded = Buffer.from(encoded.trim(), "base64");
  if (decoded.length === 42) return decoded;
  const keyLine = decoded
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("untrusted comment:"))
    .pop();
  if (!keyLine) throw new Error("updater public key has no base64 key line");
  const key = Buffer.from(keyLine, "base64");
  if (key.length !== 42) throw new Error(`unexpected updater public key length: ${key.length} (expected 42)`);
  return key;
}

/** 从 .sig 取出签名盒（2 + 8 + 64 字节）。 */
function readSignatureBox(encoded) {
  const inner = Buffer.from(encoded.trim(), "base64").toString("utf8");
  const boxLine = inner
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index) => index > 0 && line.length > 0 && !line.startsWith("trusted comment:"))
    .find((line) => {
      try {
        return Buffer.from(line, "base64").length === 74;
      } catch {
        return false;
      }
    });
  if (!boxLine) throw new Error("signature file has no 74-byte signature box line");
  return Buffer.from(boxLine, "base64");
}

try {
  const publicKey = readUpdaterPublicKey(pubkeyBase64);
  const box = readSignatureBox(fs.readFileSync(sigPath, "utf8"));

  const keyId = publicKey.subarray(2, 10);
  if (!box.subarray(2, 10).equals(keyId)) {
    console.error("signature key id does not match the configured updater public key");
    process.exit(1);
  }

  // Ed25519 的原始 32 字节公钥需要包成 SPKI DER 才能交给 Node 校验。
  const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  const keyObject = crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, publicKey.subarray(10)]),
    format: "der",
    type: "spki",
  });

  // 签名盒头两字节是算法前缀：Tauri CLI 2.12 产出 prehashed 的 "ED"，
  // 即 Ed25519 over BLAKE2b-512(文件)；较早的 "Ed" 是对文件原文签名。
  // 忽略前缀会让正确产物一律验不过——门禁恒红、发布永远停在草稿。
  const algorithm = box.subarray(0, 2).toString("latin1");
  const fileBytes = fs.readFileSync(imagePath);
  let message = fileBytes;
  let algorithmName = "Ed (Ed25519 over the raw bytes)";
  if (algorithm === "ED") {
    let digest;
    try {
      digest = crypto.createHash("blake2b512").update(fileBytes).digest();
    } catch {
      console.error("this Node build cannot compute blake2b512, which prehashed signatures need");
      process.exit(2);
    }
    message = digest;
    algorithmName = "ED (Ed25519 over BLAKE2b-512 of the bytes)";
  } else if (algorithm !== "Ed") {
    console.error(`unknown signature algorithm prefix: ${JSON.stringify(algorithm)}`);
    process.exit(2);
  }

  const verified = crypto.verify(null, message, keyObject, box.subarray(10));
  if (!verified) {
    console.error("signature does not match the AppImage bytes");
    process.exit(1);
  }
  console.log(`signature matches the AppImage bytes (${algorithmName})`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
