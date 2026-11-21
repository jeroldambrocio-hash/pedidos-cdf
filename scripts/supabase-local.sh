#!/usr/bin/env bash
# Test copy only (PayMongo branch): runs a private Supabase on this PC with Docker, built from the same migrations
# as production, so nothing here ever touches the real project (rentrooms).
#   bash scripts/supabase-local.sh            → start (first run downloads the images)
#   bash scripts/supabase-local.sh db reset   → wipe and rebuild from the migrations
#   bash scripts/supabase-local.sh stop
# Some migrations call the real project's functions by URL (push, notify, lalamove…). While the CLI applies them,
# that URL is swapped for this PC's Supabase, so the local database can never call production. The migration files
# are restored right after (git), so nothing changes in the repository.
set -euo pipefail
cd "$(dirname "$0")/.."
LIVE='https://nskbtxagdkvkxqneoucv.supabase.co/functions/v1'
LOCAL='http://host.docker.internal:54321/functions/v1'
M=supabase/migrations
# Production applied secure_prices (20261028012537) BEFORE 037 and 038 were added, and 037 needs its table. The CLI
# sorts by version number, so for this run only 037/038 get versions just after it (same rule as tests/fresh-install.cjs).
P37=037_cdf_payments_rider_alerts.sql; P38=038_cdf_quote_for_photo_owner.sql
restore(){
  rm -f "$M/20261028012538_$P37" "$M/20261028012539_$P38"
  git checkout -- "$M"   # brings back 037/038 under their real names and undoes the URL swap
}
trap restore EXIT
mv "$M/$P37" "$M/20261028012538_$P37"; mv "$M/$P38" "$M/20261028012539_$P38"
grep -rl "$LIVE" supabase/migrations | xargs -r sed -i "s#$LIVE#$LOCAL#g"
if grep -rq 'nskbtxagdkvkxqneoucv' supabase/migrations; then echo 'A migration still names the real project; stopping.' >&2; exit 1; fi
npx -y supabase@2.122.1 "${@:-start}"
