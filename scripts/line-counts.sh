#!/usr/bin/env bash
set -euo pipefail

# 列出代码文件并按行数从高到低排序，带颜色输出。
# 默认仅统计常见源码后缀；传入 --all 则统计所有被 Git 跟踪的文件。

usage() {
  cat <<'EOF'
用法: scripts/line-counts.sh [--all]
  --all  统计所有被 Git 跟踪的文件（不限定后缀）
环境变量:
  NO_COLOR  设置后关闭彩色输出
EOF
}

if [[ "${1-}" == "--help" ]]; then
  usage
  exit 0
fi

# 默认的源码后缀列表
patterns=(
  "*.ts" "*.tsx" "*.js" "*.jsx" "*.mjs" "*.cjs"
  "*.vue"
  "*.rs"
  "*.sh"
  "*.c" "*.cpp" "*.h" "*.hpp"
  "*.md"
)

# 选择文件列表
if [[ "${1-}" == "--all" ]]; then
  mapfile -d '' files < <(git ls-files -z)
else
  mapfile -d '' files < <(git ls-files -z -- "${patterns[@]}")
fi

if [[ ${#files[@]} -eq 0 ]]; then
  echo "未找到匹配文件"
  exit 0
fi

# 彩色配置（尊重 NO_COLOR，非终端自动关闭）
if [[ -t 1 && -z "${NO_COLOR-}" ]]; then
  line_color=$'\033[1;36m'
  path_color=$'\033[0;33m'
  reset=$'\033[0m'
else
  line_color=''
  path_color=''
  reset=''
fi

# 统计并排序
{
  for file in "${files[@]}"; do
    [[ -f "$file" ]] || continue
    count=$(wc -l <"$file")
    printf "%s\t%s\n" "$count" "$file"
  done
} | sort -nr -k1,1 | awk -F'\t' -v lc="$line_color" -v pc="$path_color" -v rs="$reset" '
  { printf "%s%7d%s %s%s%s\n", lc, $1, rs, pc, $2, rs }
'
