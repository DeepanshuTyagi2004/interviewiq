#!/usr/bin/env bash
# usage: pkg.sh OUT FILE...   (paths relative to the repo root). Working tree vs HEAD: no commits by the user's standing rule.
set -uo pipefail
cd /Users/salescode/Desktop/project/interviewiq
out=$1; shift
{
  echo "# Review package: working tree vs HEAD (the user commits themselves; nothing is committed)"
  echo; echo "## Files in scope"; for f in "$@"; do echo "  $f"; done
  echo; echo "## git status for these files"; git status --short -- "$@"
  echo; echo "## Diff (10 lines of context). Untracked files appear as whole-file additions."
  for f in "$@"; do
    if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then git diff -U10 HEAD -- "$f"
    elif [ -e "$f" ]; then git diff --no-index -U10 -- /dev/null "$f"
    else echo "(missing: $f)"; fi
  done
} > "$out"
echo "$out ($(wc -l < "$out" | tr -d ' ') lines)"
