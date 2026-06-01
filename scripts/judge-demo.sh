#!/usr/bin/env bash
# SlopBlock — Judge demo launcher (macOS / Linux)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[SlopBlock] Checking Git LFS models..."
if command -v git >/dev/null 2>&1; then
  git lfs pull 2>/dev/null || true
fi

if [[ ! -d node_modules ]]; then
  echo "[SlopBlock] npm install..."
  npm install
fi

if [[ ! -f demo.html ]]; then
  echo "demo.html not found" >&2
  exit 1
fi

echo "[SlopBlock] verify-models + preflight + demo service..."
echo "        Press Ctrl+C to stop."

exec npm run judge-demo
