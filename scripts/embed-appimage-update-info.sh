#!/usr/bin/env bash
#
# 把 AppImage 的更新信息写进 type-2 runtime 预留的 1 KiB `.upd_info` 段，并在旁边生成 .zsync。
#
# Tauri 的打包器把这个段留空，AppImageUpdate / AppImageLauncher 等工具因此报「no update information」
# 并拒绝就地更新（AppImageHub 也会就此给出提示）。填上它并发布同名 .zsync 后，这些工具只下载变化的块。
# 就地改写而不是重新打包：重新打包有可能改变 launcher 权限，而权限正是 AppImageHub 收录的关键条件。
#
# 用法：
#   REPO=muyuanjin/ffui TAG=v0.3.6 scripts/embed-appimage-update-info.sh path/to/FFUI_0.3.6_amd64.AppImage
#   REPO=... TAG=... scripts/embed-appimage-update-info.sh --print FFUI_0.3.6_amd64.AppImage   # 只打印不写盘
#
# 规格：https://github.com/AppImage/AppImageSpec/blob/master/draft.md#update-information
set -euo pipefail

: "${REPO:?Set REPO to the GitHub repository, e.g. muyuanjin/ffui}"
: "${TAG:?Set TAG to the release tag, e.g. v0.3.6}"

print_only=false
if [[ "${1:-}" == "--print" ]]; then
  print_only=true
  shift
fi

appimage="${1:?Pass the path to the .AppImage}"
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "REPO is not an owner/name pair: $REPO" >&2; exit 1; }
owner="${REPO%%/*}"
name="${REPO##*/}"

version="${TAG#v}"
base="$(basename "$appimage")"

# 更新信息必须匹配**将来每个**版本，所以把文件名里的版本号换成通配；
# 由文件名推导（而不是写死）可让两者同步，下方的守卫则把「将来改了产物命名」变成响亮失败。
pattern="${base/_${version}_/_*_}"
[[ "$pattern" != "$base" ]] || { echo "AppImage name '$base' does not contain _${version}_; cannot derive a zsync pattern" >&2; exit 1; }
update_information="gh-releases-zsync|${owner}|${name}|latest|${pattern}.zsync"

if [[ "$print_only" == true ]]; then printf '%s\n' "$update_information"; exit 0; fi

[[ -f "$appimage" ]] || { echo "No such AppImage: $appimage" >&2; exit 1; }

# objdump -h 的列：Idx Name Size VMA LMA "File off" Algn，取 $3/$6；
# 十六进制在 bash 里转换（mawk 没有 strtonum）。
read -r size_hex offset_hex < <(objdump -h "$appimage" | awk '$2 == ".upd_info" { print $3, $6; exit }')
[[ "${size_hex:-}" =~ ^[0-9a-fA-F]+$ && "${offset_hex:-}" =~ ^[0-9a-fA-F]+$ ]] || { echo "No .upd_info section in $appimage; is it an AppImage type-2 runtime?" >&2; exit 1; }
size=$((16#$size_hex))
offset=$((16#$offset_hex))
(( size > 0 )) || { echo "The .upd_info section in $appimage is empty" >&2; exit 1; }
(( ${#update_information} < size )) || { echo "Update information (${#update_information} bytes) does not fit in the ${size}-byte .upd_info section" >&2; exit 1; }

# 整段覆写并补 NUL：读取方在第一个 NUL 处停止，残留字节会污染字符串。
# 用 dd 而不是 objcopy：objcopy 会重写 ELF，丢掉其后的 squashfs 镜像。
{
  printf '%s' "$update_information"
  head -c "$((size - ${#update_information}))" /dev/zero
} | dd of="$appimage" bs=1 seek="$offset" count="$size" conv=notrunc status=none

embedded="$(dd if="$appimage" bs=1 skip="$offset" count="$size" status=none | tr -d '\0')"
[[ "$embedded" == "$update_information" ]] || { echo "Verification failed: .upd_info holds '$embedded', expected '$update_information'" >&2; exit 1; }
echo "Embedded update information: $update_information"

# .zsync 必须基于改写后的镜像生成，否则校验和描述的已不是实际提供的文件。
command -v zsyncmake >/dev/null || { echo "zsyncmake not found; install the 'zsync' package" >&2; exit 1; }
zsyncmake \
  -u "https://github.com/${REPO}/releases/download/${TAG}/${base}" \
  -o "${appimage}.zsync" \
  "$appimage"
echo "Wrote ${appimage}.zsync"
