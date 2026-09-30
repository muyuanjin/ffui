#!/usr/bin/env bash
# 校验构建产物能否被 AppImageHub 的「非属主 / 沙箱」场景接受。
#
# 四个阶段，任一失败即退出非零：
#   1) 结构：.DirIcon 与 .desktop 必须是可解析的相对链接，并跑官方 appdir-lint.sh
#   2) 权限面：读**镜像内的存储模式**（unsquashfs -o <offset> -d），要求文件 other-readable、
#      属主可执行文件 other-executable、目录 other-traversable。
#      不能用 `--appimage-extract` 的产物判定：type2 runtime 解包时对所有目录 mkdir(0700)
#      （runtime.c 的 mkdir_p），与镜像内模式无关，会让任何产物都恒红。
#      AppImageHub 在 firejail 里以别的 uid 挂载，属主位不生效 —— tauri#16155（AppRun.wrapped 0770）。
#   3) 非属主启动：以 root 按存储模式解包（payload 归 root），再以普通用户跑 AppRun，
#      要求 Xvfb 下出现窗口。
#   4) 原样 harness：下载 AppImageHub 的 code/ 并跑 code/worker.sh；firejail 无法建立自己沙箱时跳过。
#
# 用法：bash scripts/verify-appimage.sh <path/to/App.AppImage>
# 环境变量：
#   RUN_HARNESS=1        跑第 4 阶段（默认 0）
#   REQUIRE_HARNESS=1    本环境无法跑第 4 阶段时必须失败（CI 用）
#   APPIMAGES_COMMIT=<ref> 阶段 1 取用 appdir-lint.sh/excludelist 的 AppImage/AppImages 提交，
#                        默认钉在 19e30b276ffedf4d3b4b56bc6320f463625a74f8（写权限作业不应执行上游 master 的内容）
#   HARNESS_COMMIT=<ref> 第 4 阶段取用的 AppImageHub 版本，默认 master（有意跟随目录站当前行为，
#                        代价是上游改动会影响本门禁；需要可复现时传具体 sha）
#   WORKER_TIMEOUT=<秒>  worker.sh 单次超时，默认 600
# 依赖：unsquashfs（squashfs-tools）、xvfb/icewm（阶段 3）、firejail（阶段 4）
set -euo pipefail
# unsquashfs 会用调用方 umask 掩码解包出的模式（实测 umask 077 下普通文件全被掩成非 other 可读），
# 而权限面必须看到镜像内存储模式，所以固定 umask。
umask 022

# 任何未被 || 兜住的命令失败都要**带阶段名与命令**地失败，否则 CI 上只剩 trap 的临时目录提示。
STAGE="启动"
on_error() {
  local rc=$?
  echo "verify-appimage: FAIL: ${STAGE} 中的命令失败（exit ${rc}）：${BASH_COMMAND}" >&2
  exit "$rc"
}
trap on_error ERR

env_or() { # env_or NAME DEFAULT（不用参数展开默认值，set -u 下也安全）
  local v
  v="$(printenv "$1" 2>/dev/null || true)"
  if [ -z "$v" ] ; then printf "%s" "$2" ; else printf "%s" "$v" ; fi
}

IMG="$1"
RUN_HARNESS="$(env_or RUN_HARNESS 0)"
REQUIRE_HARNESS="$(env_or REQUIRE_HARNESS 0)"
APPIMAGES_COMMIT="$(env_or APPIMAGES_COMMIT 19e30b276ffedf4d3b4b56bc6320f463625a74f8)"
# 目录站里的条目名（data/<条目名> 的文件名）；harness 用它决定产物文件名与导出目标。
APP_NAME="$(env_or APP_NAME FFUI)"
# 条目由本次 PR 新增时目录站按 STRICT 校验命名（新增文件为 true）。
APP_STRICT="$(env_or APP_STRICT true)"
HARNESS_COMMIT="$(env_or HARNESS_COMMIT master)"
WORKER_TIMEOUT="$(env_or WORKER_TIMEOUT 600)"
if [ "$REQUIRE_HARNESS" = "1" ] && [ "$RUN_HARNESS" != "1" ] ; then
  echo "verify-appimage: REQUIRE_HARNESS=1 时必须同时 RUN_HARNESS=1（否则等于放行未跑的验收）" >&2
  exit 1
fi
[ -f "$IMG" ] || { echo "verify-appimage: 找不到 $IMG" >&2; exit 2; }
IMG="$(readlink -f "$IMG")"
BASENAME="$(basename "$IMG")"

WORK="$(mktemp -d)"
# 以副本执行，避免调用方给的文件没有可执行位（下载来的 release 资产通常就是 644）
cp "$IMG" "$WORK/$BASENAME"
chmod +x "$WORK/$BASENAME"
IMG="$WORK/$BASENAME"
XVFB_PID=""
WM_PID=""
APP_PID=""
cleanup() {
  RC=$?
  set +e
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
  [ -n "$WM_PID" ] && kill "$WM_PID" 2>/dev/null
  [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null
  fusermount -u -z "$WORK/rootrun/squashfs-root" 2>/dev/null
  if [ "$RC" -ne 0 ] ; then
    echo "--- 失败现场：$WORK （已保留，便于排查）" >&2
    return "$RC"
  fi
  # 阶段 3 的运行树归 root 所有，普通 rm 删不掉（会留下 ~200MB 与 Permission denied）。
  sudo -n rm -rf "$WORK" 2>/dev/null || rm -rf "$WORK" 2>/dev/null || true
  return 0
}
trap cleanup EXIT

fail() { echo "verify-appimage: FAIL: $1" >&2; exit 1; }
ok() { echo "verify-appimage: OK: $1"; }

# ---------- 阶段 1：结构 ----------
STAGE="[1/4] 结构"
echo "== [1/4] 结构：.DirIcon / .desktop / appdir-lint =="
( cd "$WORK" && "$IMG" --appimage-extract >extract.log 2>&1 ) || { tail -n 20 "$WORK/extract.log" >&2; fail "appimage-extract 失败"; }
ROOT="$WORK/squashfs-root"
[ -e "$ROOT/.DirIcon" ] || fail ".DirIcon 不存在或不可解析（挂载后会被 appdir-lint 判为缺失）"
for entry in "$ROOT/.DirIcon" "$ROOT"/*.desktop "$ROOT"/usr/share/applications/*.desktop ; do
  [ -L "$entry" ] || continue
  target="$(readlink "$entry")"
  echo "   $entry -> $target"
  case "$target" in /*) fail "$entry 是绝对符号链接，挂载后会悬空" ;; esac
done
# 与 harness 同理：本作业持写权限，lint 脚本也钉到具体提交（改提交需显式覆盖并重审）。
# 阶段 4 会把这两份文件预置进 harness 的 deps/，使它内部的 fetch-deps.sh 不再去抓 master 版；
# 该 harness 的其它依赖仍来自它自己的 release 资产与 alpine 稳定分支（有意原样跑目录站脚本）。
( cd "$WORK" && curl -fsSL -o appdir-lint.sh "https://raw.githubusercontent.com/AppImage/AppImages/$APPIMAGES_COMMIT/appdir-lint.sh" \
            && curl -fsSL -o excludelist "https://raw.githubusercontent.com/AppImage/AppImages/$APPIMAGES_COMMIT/excludelist" )
if ! command -v desktop-file-validate >/dev/null 2>&1 || ! command -v mimetype >/dev/null 2>&1 ; then
  sudo -n apt-get update -qq >/dev/null 2>&1 || true
  sudo -n apt-get install -y -qq desktop-file-utils libfile-mimeinfo-perl >/dev/null 2>&1 || true
fi
( cd "$WORK" && bash appdir-lint.sh "$ROOT" ) || fail "appdir-lint.sh 报了 fatal 问题"

# ---------- 阶段 2：权限面（other 位）----------
STAGE="[2/4] 权限面"
echo "== [2/4] 权限面（镜像内存储模式）：other-readable / other-executable / other-traversable =="
command -v unsquashfs >/dev/null 2>&1 || fail "缺少 unsquashfs（squashfs-tools）：--appimage-extract 的目录模式恒为 0700，不能作为权限判据"
OFFSET="$("$IMG" --appimage-offset)"
STORE="$WORK/store"
rm -rf "$STORE"
unsquashfs -o "$OFFSET" -d "$STORE" "$IMG" >"$WORK/unsquashfs.log" 2>&1 || { tail -n 10 "$WORK/unsquashfs.log" >&2; fail "unsquashfs 解包失败"; }
OFFENDERS="$(find "$STORE" \( -type f ! -perm -o+r \) -o \( -type f -perm -u+x ! -perm -o+x \) -o \( -type d ! -perm -o+x \) | head -n 25 || true)"
if [ -n "$OFFENDERS" ] ; then
  echo "$OFFENDERS" | sed -e 's/^/   /' >&2
  fail "AppDir 里存在非属主无法读取/执行/进入的条目（firejail、root 挂载或别的 uid 下无法启动）"
fi
ok "权限面（镜像内存储模式）：全部条目对 other 可读/可执行/可进入"

# ---------- 阶段 3：非属主启动（root 解包 + 普通用户运行）----------
STAGE="[3/4] 非属主启动"
echo "== [3/4] 非属主启动：Xvfb + 窗口检查 =="
ROOTRUN="$WORK/rootrun"
mkdir -p "$ROOTRUN"
# 以 root 按存储模式解包：runtime 的 --appimage-extract 会把目录建成 0700，
# 那样非属主连 cd 都进不去，与产物真实可接受性无关。
sudo -n unsquashfs -o "$OFFSET" -d "$ROOTRUN/squashfs-root" "$IMG" >/dev/null 2>&1 || fail "需要免密 sudo 以 root 按存储模式解包（阶段 3）"
APPDIR="$ROOTRUN/squashfs-root"
OWNER="$(stat -c %U "$APPDIR")"
[ "$OWNER" = root ] || fail "阶段 3 需要 root 属主的 payload（当前 $OWNER）"

XDISP=":97"
Xvfb "$XDISP" -screen 0 800x600x24 >/dev/null 2>&1 &
XVFB_PID=$!
sleep 2
export DISPLAY="$XDISP"
# 只在这个 X 服务器上判定：清掉 Wayland（WSLg 会把窗口渲染到 Windows 桌面，Xvfb 上就没有窗口）。
unset WAYLAND_DISPLAY
export GDK_BACKEND=x11
icewm >/dev/null 2>&1 &
WM_PID=$!
sleep 2
(
  cd "$APPDIR"
  WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 QTWEBENGINE_DISABLE_SANDBOX=1 \
    ./AppRun >"$WORK/app.log" 2>&1 &
  echo $! >"$WORK/app.pid"
)
sleep 3
APP_PID="$(cat "$WORK/app.pid" 2>/dev/null || true)"

FOUND=""
i=0
while [ "$i" -lt 30 ] ; do
  # 候选：WM_CLASS/标题命中（xwininfo 的类名带引号：("ffui" "Ffui")），且不是 1x1/10x10 占位窗口；
  # 再逐个校验窗口确实已映射（IsViewable）——排除『存在但从未显示』的窗口。
  # 命中行直接取自本次列举：窗口可能在两次查询之间消失，二次查询既可能空手而归
  #（set -e 下会中断脚本、连诊断都打不出来），也没有必要。
  CANDIDATES="$(xwininfo -root -tree 2>/dev/null | grep -E '^ +0x' | grep -E '"ffui"|"FFUI"' | grep -vE ' 1x1\+| 10x10\+' || true)"
  while IFS= read -r line ; do
    [ -n "$line" ] || continue
    wid="$(printf '%s' "$line" | awk '{print $1}')"
    if xwininfo -id "$wid" 2>/dev/null | grep -q 'IsViewable' ; then FOUND="$line" ; break ; fi
  done <<EOF
$CANDIDATES
EOF
  if [ -n "$FOUND" ] ; then break ; fi
  i=$((i + 1))
  sleep 1
done
if [ -z "$FOUND" ] ; then
  echo "--- 应用输出（60 行）---" >&2
  tail -n 60 "$WORK/app.log" >&2 || true
  echo "--- 相关进程 ---" >&2
  pgrep -af 'ffui|WebKit' >&2 || true
  fail "非属主启动 30 秒内没有出现窗口（沙箱/别的 uid 下无法启动）"
fi
echo "$FOUND" | sed -e 's/^/   window: /'
import -window root "$WORK/window.png" 2>/dev/null || true
ok "非属主启动：窗口已出现（截图 $WORK/window.png）"
kill "$APP_PID" 2>/dev/null || true

# ---------- 阶段 4：原样 harness ----------
if [ "$RUN_HARNESS" = "1" ] ; then
  STAGE="[4/4] harness"
echo "== [4/4] AppImageHub 原样 harness（code/worker.sh）=="
  # 注意不要加 --quiet：它恰好抑制掉要匹配的 "an existing sandbox was detected"。
  if firejail --noprofile true 2>&1 | grep -q "existing sandbox" ; then
    echo "   SKIP: 当前环境在沙箱内（WSL/容器），firejail 无法建立自己的沙箱；CI 的 ubuntu-22.04 上会真正执行"
    if [ "$REQUIRE_HARNESS" = "1" ] ; then fail "本环境无法运行原样 harness，但 REQUIRE_HARNESS=1" ; fi
  else
    HDIR="$WORK/harness"
    mkdir -p "$HDIR"
    curl -fsSL "https://codeload.github.com/AppImage/appimage.github.io/tar.gz/$HARNESS_COMMIT" | tar xz -C "$HDIR" --strip-components=1
    # 预置阶段 1 已下载的 pinned lint 文件：fetch-deps.sh 只在缺失时才下载，
    # 因此阶段 4 的 worker.sh 用的也是钉住的 lint，而不是它自己会抓的 master 版。
    mkdir -p "$HDIR/deps"
    for lintFile in appdir-lint.sh excludelist ; do
      [ -f "$WORK/$lintFile" ] || fail "阶段 1 未留下 $lintFile，无法预置给阶段 4"
      cp "$WORK/$lintFile" "$HDIR/deps/$lintFile"
    done
    ( cd "$HDIR" && bash code/fetch-deps.sh >fetch-deps.log 2>&1 ) || { tail -n 10 "$HDIR/fetch-deps.log" >&2; fail "fetch-deps.sh 失败"; }
    cp -a "$HDIR/deps/." "$HDIR/"
    cp -a "$IMG" "$HDIR/$BASENAME"
    # 目录站的工作流会先准备一个 dummy 声卡；缺失不致命，但保持同等条件
    ( cd "$HDIR" && sudo bash code/prep-dummy-soundcard.sh >/dev/null 2>&1 || true )
    ( cd "$HDIR" && python3 -m http.server 18080 >/dev/null 2>&1 & echo $! >http.pid )
    sleep 2
    # 目录站的调用约定：worker.sh 的参数是「以应用名命名的数据文件路径」，第一行是 URL，
    # 文件 basename 即应用名；导出阶段同样会读这个文件（缺了它 harness 必以非零退出）。
    mkdir -p "$HDIR/data"
    printf 'http://127.0.0.1:18080/%s\n' "$BASENAME" >"$HDIR/data/$APP_NAME"
    ( cd "$HDIR" && DISPLAY="$XDISP" STRICT="$APP_STRICT" WORKER_TIMEOUT="$WORKER_TIMEOUT" timeout "$WORKER_TIMEOUT" bash -e code/worker.sh "$(readlink -f "$HDIR/data/$APP_NAME")" >worker.log 2>&1 ) || {
      echo "--- harness 关键行（已过滤 set -v/-x 源码回显）---" >&2
      grep -nE 'Permission denied|ERROR|FATAL|no window|Could not' "$HDIR/worker.log" | grep -vE 'echo "|^[0-9]+:[[:space:]]*#' | tail -n 15 >&2 || true
      echo "--- harness 日志尾部（120 行：失败点通常在末尾）---" >&2
      tail -n 120 "$HDIR/worker.log" >&2 || true
      echo "--- 是否出现应用测试成功的标记 ---" >&2
      grep -n 'SUCCESS :-)' "$HDIR/worker.log" >&2 || echo "   （未出现 SUCCESS：失败发生在应用测试阶段）" >&2
      echo "--- 相关进程 ---" >&2
      pgrep -af 'firejail|ffui|WebKit' >&2 || true
      fail "原样 harness 未通过（见 $HDIR/worker.log）"
    }
    ok "原样 harness：AppImageHub 的 worker.sh 通过"
    kill "$(cat "$HDIR/http.pid" 2>/dev/null)" 2>/dev/null || true
  fi
else
  echo "== [4/4] 跳过原样 harness（RUN_HARNESS=0）=="
fi

ok "全部阶段通过：$IMG"
