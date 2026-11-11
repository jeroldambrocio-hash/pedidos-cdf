#!/usr/bin/env bash
# Publishes the committed web files (HEAD) to Netlify production.
# Netlify does not build from GitHub here, so this copies only the web files to a clean folder,
# writes version.json (the open app checks it and refreshes itself when it changes) and deploys.
# Usage: scripts/deploy-netlify.sh            (needs the Netlify CLI, logged in)
#        PUBLIC_FORM=1 scripts/deploy-netlify.sh   also publishes the public order form (pedido.html): only once
#                                                  Phase 2/3 are approved and cdf-public-order is live with PUBLIC_ORDER=on
set -euo pipefail
cd "$(dirname "$0")/.."
SITE=79c4bd06-b12f-4f92-9b06-8be1c54cbae0
FILES="index.html seguimiento.html styles.css config.js i18n.js tracking.js sw.js manifest.webmanifest js img _redirects netlify.toml"
if [ "${PUBLIC_FORM:-}" = "1" ]; then FILES="$FILES pedido.html"; fi

if [ -n "$(git status --porcelain -- $FILES)" ]; then
  echo "There are uncommitted changes in the web files; commit them first (this publishes HEAD)." >&2
  exit 1
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
git archive HEAD $FILES | tar -x -C "$OUT"
COMMIT="$(git rev-parse --short HEAD)"
printf '{"v":"%s-%s"}\n' "$COMMIT" "$(date -u +%Y%m%d%H%M%S)" > "$OUT/version.json"

netlify deploy --prod --no-build --dir "$OUT" --site "$SITE" --message "$(git log --oneline -1 | cut -c1-72)"
