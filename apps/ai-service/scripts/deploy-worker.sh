#!/usr/bin/env bash
# Deploy the voice worker to LiveKit Cloud (`pnpm deploy:worker` from the repo root). Needs `lk` signed in to the interviewiq project (`lk cloud auth`).
# It deploys from a clean copy of the Python files: this folder's package.json (a thin wrapper for turbo) makes the CLI treat it as a Node project.
# Secrets are kept by LiveKit between deploys; change them with `lk agent update --secrets-file <file>` (do not set LIVEKIT_*, LiveKit injects them).
set -euo pipefail

command -v lk >/dev/null || { echo "deploy-worker: the LiveKit CLI is not installed (brew install livekit-cli)" >&2; exit 1; }

here="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -R "$here/app" "$stage/app"
cp "$here/requirements.txt" "$here/Dockerfile" "$here/start.sh" "$here/livekit.toml" "$stage/"
find "$stage" -name __pycache__ -type d -prune -exec rm -rf {} +

cd "$stage"
lk agent deploy --yes
