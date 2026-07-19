#!/usr/bin/env bash
# Longbox CI preflight — reproduces .github/workflows/ci.yaml locally.
#
# CI splits into two independent jobs gated by which paths changed
# (dorny/paths-filter): `check-rust` and `check-typescript`. This script
# does the same categorization against the origin/main merge-base and runs
# ONLY the gates for the areas you actually touched, in the same order CI
# runs them — so you find fmt/clippy/schema/test failures before you push,
# not after.
#
# Usage:
#   scripts/preflight.sh          # auto-detect changed areas vs origin/main
#   scripts/preflight.sh --all    # force-run every gate regardless of diff

set -uo pipefail

# Run from the repo root so cargo/yarn resolve correctly no matter where the
# script is invoked from.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
	echo "not inside a git repository" >&2
	exit 2
}
cd "$ROOT" || exit 2

FORCE_ALL=0
[ "${1:-}" = "--all" ] && FORCE_ALL=1

# tty-aware colors (stay quiet when piped/redirected)
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; D=$'\033[2m'; Z=$'\033[0m'; else B=; G=; R=; D=; Z=; fi

# --- figure out what changed ------------------------------------------------
# Base = origin/main if present, else local main, else no base (working tree
# only). We use the merge-base so the diff matches what a PR would show.
base=""
for ref in origin/main main; do
	if git rev-parse --verify --quiet "$ref" >/dev/null; then base="$ref"; break; fi
done

changed_files() {
	{
		if [ -n "$base" ]; then
			mb="$(git merge-base "$base" HEAD 2>/dev/null)"
			[ -n "$mb" ] && git diff --name-only "$mb"...HEAD
		fi
		git diff --name-only HEAD                # staged + unstaged (tracked)
		git ls-files --others --exclude-standard # untracked new files
	} 2>/dev/null | sort -u
}

FILES="$(changed_files)"

run_rust=0
run_frontend=0
if [ "$FORCE_ALL" = 1 ]; then
	run_rust=1; run_frontend=1
	echo "${D}· --all: running every gate${Z}"
elif [ -z "$FILES" ]; then
	run_rust=1; run_frontend=1
	echo "${D}· no changes detected vs ${base:-working tree} — running every gate${Z}"
else
	# Same path filters as .github/workflows/ci.yaml
	echo "$FILES" | grep -qE '^(apps/server/|core/|crates/)' && run_rust=1
	echo "$FILES" | grep -qE '^(apps/web/|packages/)'         && run_frontend=1
	echo "${D}· changed areas:${Z} rust=$run_rust frontend=$run_frontend"
fi

# --- gate runner ------------------------------------------------------------
# Initialize empty (not just `declare -a`): under `set -u`, an array that is
# declared but never assigned is treated as unset, so `${#FAILED[@]}` in the
# summary would error with "unbound variable" precisely when every gate passed
# (and FAILED was never appended to).
declare -a FAILED=()
gate() { # gate "label" cmd [args...]
	local label="$1"; shift
	printf '\n%s▶ %s%s\n' "$B" "$label" "$Z"
	if "$@"; then
		printf '%s✓ %s%s\n' "$G" "$label" "$Z"
	else
		local rc=$?
		printf '%s✗ %s (exit %d)%s\n' "$R" "$label" "$rc" "$Z"
		FAILED+=("$label")
	fi
}

if [ "$run_rust" = 1 ]; then
	echo; echo "${B}── Rust gates ──────────────────────────────${Z}"
	gate "cargo fmt --check"        cargo fmt --all -- --check
	gate "cargo clippy -D warnings" cargo clippy -- -D warnings
	gate "graphql schema in sync"   cargo dump-schema -- --check
	gate "cargo test"               cargo test
fi

if [ "$run_frontend" = 1 ]; then
	echo; echo "${B}── Frontend gates ──────────────────────────${Z}"
	gate "yarn lint + check-types"  yarn lint
	gate "yarn test"                yarn test
fi

# --- summary ----------------------------------------------------------------
echo
if [ "${#FAILED[@]}" -eq 0 ]; then
	printf '%s✔ preflight passed — safe to push%s\n' "$G" "$Z"
	exit 0
fi
printf '%s✗ preflight FAILED: %s%s\n' "$R" "${FAILED[*]}" "$Z"
exit 1
