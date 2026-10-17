#!/usr/bin/env bash
# Build and ship Recipie to the server.
#
#   ./deploy.sh            test, build, upload, restart
#   ./deploy.sh --no-test  skip the test suites
#
# The target comes from .deploy.env (gitignored; see .deploy.env.example), so
# no server address lives in the repo. The server side (systemd units, nginx,
# Kanidm clients) is declared in the NixOS config, not here.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .deploy.env ]] || { echo "Missing .deploy.env. Copy .deploy.env.example and fill it in." >&2; exit 1; }
# shellcheck disable=SC1091
source .deploy.env
: "${DEPLOY_HOST:?set in .deploy.env}" "${DEPLOY_USER:?set in .deploy.env}"
: "${DEPLOY_APP_DIR:=/home/anish/recipie}" "${DEPLOY_WEB_DIR:=/var/www/recipes.anishsheela.com}"
target="$DEPLOY_USER@$DEPLOY_HOST"

if [[ "${1:-}" != "--no-test" ]]; then
  echo "==> Tests"
  (cd backend && { [[ -x .venv/bin/pytest ]] || { uv venv -q .venv && uv pip install -q -e '.[dev]'; }; } && .venv/bin/pytest -q)
  (cd frontend && npx vitest run)
fi

echo "==> Building the PWA"
(cd frontend && npm ci --silent && npm run build)

echo "==> Uploading"
ssh "$target" "mkdir -p '$DEPLOY_APP_DIR/backend'"
rsync -az --delete --exclude '__pycache__' backend/recipie/ "$target:$DEPLOY_APP_DIR/backend/recipie/"
# Hashed assets: upload the new ones first, swap index.html and the service
# worker last, then prune. A phone mid-load never gets an index.html that
# points at files not uploaded yet.
rsync -az --exclude 'index.html' --exclude 'sw.js' frontend/dist/ "$target:$DEPLOY_WEB_DIR/"
rsync -az frontend/dist/index.html frontend/dist/sw.js "$target:$DEPLOY_WEB_DIR/"
rsync -az --delete frontend/dist/ "$target:$DEPLOY_WEB_DIR/"

echo "==> Restarting"
ssh "$target" "sudo systemctl restart recipie-web recipie-mcp && systemctl is-active recipie-web recipie-mcp"
echo "Deployed."
