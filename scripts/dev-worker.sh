#!/bin/bash
# =============================================================================
# dev-worker.sh — Runs the BullMQ publish worker with hot-reload via tsx watch
# =============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Starting publish worker with hot-reload (tsx watch)..."
echo "    Press Ctrl+C to stop."
echo ""

exec npx tsx watch src/workers/publish.worker.ts
