#!/bin/bash
# =============================================================================
# setup.sh — One-shot developer bootstrap for social-media-autopost
# =============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "==> Installing Node dependencies..."
npm install

echo ""
echo "==> Installing Playwright Chromium browser..."
npx playwright install chromium

echo ""
echo "==> Creating .env from .env.example (skipped if .env already exists)..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    .env created. Edit it with your DATABASE_URL, REDIS_URL, etc."
else
  echo "    .env already exists — skipping."
fi

echo ""
echo "==> Creating required runtime directories..."
for dir in sessions uploads processed logs; do
  mkdir -p "$REPO_ROOT/$dir"
  echo "    $REPO_ROOT/$dir"
done

echo ""
echo "==> Running prisma generate..."
npx prisma generate

echo ""
echo "============================================================"
echo " Setup complete!"
echo ""
echo " Next steps:"
echo ""
echo "  1. Edit .env with your DATABASE_URL, REDIS_URL, and other"
echo "     environment variables."
echo ""
echo "  2. Start PostgreSQL (if not already running), then run:"
echo "       npx prisma migrate dev --name init"
echo ""
echo "  3. Start Redis:"
echo "       docker run -d -p 6379:6379 redis:7-alpine"
echo ""
echo "  4. Start the Next.js dev server:"
echo "       npm run dev"
echo ""
echo "  5. In a separate terminal, start the publish worker:"
echo "       npm run worker"
echo ""
echo " Or run everything at once (requires concurrently):"
echo "   npx concurrently \"npm run dev\" \"npm run worker\""
echo "============================================================"
