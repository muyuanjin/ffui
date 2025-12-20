#!/usr/bin/env bash
set -euo pipefail

print_usage() {
  cat <<'USAGE'
Usage: scripts/test-rust-wsl.sh [--threads N] [--target-dir PATH] [-- <cargo test args...>]

Runs Rust backend tests using the Linux Cargo binary and puts build
artifacts under a Linux filesystem target dir (helpful when the repo is on
/mnt/<drive> in WSL).

Options:
  --threads N        Passes --test-threads=N to the Rust test harness (default: min(nproc, 8))
  --target-dir PATH  Passes --target-dir PATH to Cargo (default: $XDG_CACHE_HOME/ffui/cargo-target)
  -h, --help         Show this help

Examples:
  scripts/test-rust-wsl.sh
  scripts/test-rust-wsl.sh --threads 4
  scripts/test-rust-wsl.sh -- --package ffui -- tests::get_preview_data_url_builds_data_url_prefix
USAGE
}

threads=""
target_dir=""
forward_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --threads)
      threads="${2:-}"
      shift 2
      ;;
    --target-dir)
      target_dir="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    --)
      shift
      forward_args+=("$@")
      break
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$threads" ]]; then
  if command -v nproc >/dev/null 2>&1; then
    threads="$(nproc)"
  else
    threads="4"
  fi
  if [[ "$threads" =~ ^[0-9]+$ ]] && (( threads > 8 )); then
    threads="8"
  fi
fi

if [[ -z "$target_dir" ]]; then
  cache_home="${XDG_CACHE_HOME:-$HOME/.cache}"
  target_dir="${cache_home}/ffui/cargo-target"
fi

mkdir -p "$target_dir"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest_path="${repo_root}/src-tauri/Cargo.toml"

if [[ ! -f "$manifest_path" ]]; then
  echo "Missing Cargo manifest: ${manifest_path}" >&2
  exit 2
fi

cargo_bin="$(type -P cargo || true)"
if [[ -z "$cargo_bin" ]]; then
  echo "cargo is required to run Rust tests." >&2
  exit 2
fi
if [[ "$cargo_bin" == *.exe ]]; then
  echo "Expected a Linux cargo binary, got: ${cargo_bin}" >&2
  exit 2
fi

separator_index=-1
for i in "${!forward_args[@]}"; do
  if [[ "${forward_args[$i]}" == "--" ]]; then
    separator_index="$i"
    break
  fi
done

if (( separator_index >= 0 )); then
  cargo_args=("${forward_args[@]:0:separator_index}")
  test_args=("${forward_args[@]:separator_index+1}")
else
  cargo_args=("${forward_args[@]}")
  test_args=()
fi

has_test_threads=false
for a in "${test_args[@]}"; do
  if [[ "$a" == "--test-threads" || "$a" == --test-threads=* ]]; then
    has_test_threads=true
    break
  fi
done

if ! $has_test_threads; then
  test_args+=("--test-threads=${threads}")
fi

exec "$cargo_bin" test \
  --manifest-path "$manifest_path" \
  --target-dir "$target_dir" \
  "${cargo_args[@]}" \
  -- "${test_args[@]}"
