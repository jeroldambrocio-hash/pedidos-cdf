#!/usr/bin/env bash
# Test copy only: share the PayMongo test with someone else (e.g. the owner on their phone) for as long as this runs.
# Needs Docker with the local Supabase already started (bash scripts/supabase-local.sh). Ctrl+C stops the sharing.
#   bash scripts/share-test.sh
# It opens two temporary Cloudflare links (they change every time): one for the app, one for the local Supabase,
# runs the app on port 4335 pointing at that link, and the PayMongo function with the app's link for the return pages.
# Only TEST data and TEST payments: nothing reaches production (rentrooms) or charges real money.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cloudflared >/dev/null || { echo "cloudflared is not installed"; exit 1; }
curl -s -o /dev/null http://127.0.0.1:54321/rest/v1/ || { echo "Start the local Supabase first: bash scripts/supabase-local.sh"; exit 1; }
LOGS=$(mktemp -d); PIDS=()
cleanup(){ for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; echo; echo "Sharing stopped."; }
trap cleanup EXIT
tunnel(){ cloudflared tunnel --no-autoupdate --url "$1" > "$2" 2>&1 & PIDS+=($!); }
url_of(){ for _ in $(seq 1 60); do u=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$1" | head -1 || true); [ -n "$u" ] && { echo "$u"; return; }; sleep 1; done; echo "Could not open a Cloudflare link ($1)" >&2; exit 1; }
tunnel http://localhost:54321 "$LOGS/api.log"; tunnel http://localhost:4335 "$LOGS/web.log"
API=$(url_of "$LOGS/api.log"); WEB=$(url_of "$LOGS/web.log")
# The function's settings: keep the PayMongo TEST keys, point the return pages and allowed site at the shared link
grep -vE '^(CDF_APP_URL|CDF_PAY_ORIGINS|PUBLIC_ORDER_ORIGINS)=' .secrets/functions.env > "$LOGS/functions.env"
printf 'CDF_APP_URL=%s\nCDF_PAY_ORIGINS=%s,http://localhost:4334,http://localhost:4335\nPUBLIC_ORDER_ORIGINS=%s,http://localhost:4334,http://localhost:4335\n' "$WEB" "$WEB" "$WEB" >> "$LOGS/functions.env"
docker rm -f supabase_edge_runtime_cdf-paymongo-test >/dev/null 2>&1 || true   # a runtime left from an earlier run blocks a new one
npx -y supabase@2.122.1 functions serve --env-file "$LOGS/functions.env" > "$LOGS/functions.log" 2>&1 & PIDS+=($!)
PORT=4335 CDF_TEST_API="$API" node scripts/serve-test.mjs > "$LOGS/web-server.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 60); do curl -s -o /dev/null -X OPTIONS -H "Origin: $WEB" "http://127.0.0.1:54321/functions/v1/cdf-paymongo" -w '%{http_code}' | grep -q 204 && break; sleep 2; done
echo
echo "  App (team and customer pages): $WEB"
echo "  Test accounts: .secrets/test-accounts.txt  (dueno, moderador, florista, repartidor)"
echo "  PayMongo is in TEST mode: use the test GCash/Maya pages, no real money."
echo "  Leave this window open while you test. Ctrl+C to stop sharing."
wait
