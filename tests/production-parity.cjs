// Phase 6: does the repo match production, and what exactly do Phases 1–5 add to it?
//  1. The repo's migrations up to today's production (before Phase 1) give the same tables, columns,
//     policies, functions (security definer, search_path, who may run them), grants, triggers, buckets
//     and realtime tables as production itself (tests/fixtures/production-manifest-2026-11-11.json,
//     read from production with tests/lib/manifest.sql, read-only).
//  2. Phases 1–5 on top of that only add: nothing of production changes or disappears.
//  3. Everything they add is locked down: RLS on every new table, no new access for anon, every
//     security-definer function with an empty search_path.
//  4. A fresh install (all migrations at once) ends up identical to the upgrade.
//  5. The rollback script (supabase/rollback) takes it back to production.
// Writes the list of additions to .impeccable/review/phase6-additions.json for the report.
// NODE_PATH=.test-tools/node_modules node tests/production-parity.cjs
const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs'), path = require('path'), assert = require('assert');
const { build, migration, migrationFiles } = require('./lib/fresh-db.cjs');
const ok = (n) => console.log('ok ' + n);
const MANIFEST = fs.readFileSync(path.join(__dirname, 'lib/manifest.sql'), 'utf8');
const prod = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/production-manifest-2026-11-11.json'), 'utf8'));
const PHASES = ['cdf_create_order_with_payment', 'cdf_public_uploads', 'cdf_order_requests', 'cdf_branch_ranking', 'cdf_lalamove_events', 'cdf_cron', 'cdf_request_expiry', 'cdf_lalamove_reconcile_fix'];

const manifest = async (db) => (await db.query(MANIFEST)).rows[0].manifest;
const keys = (o) => Object.keys(o || {}).sort();
const canon = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x);
const norm = (m) => ({ ...m, tables: Object.fromEntries(Object.entries(m.tables || {}).map(([k, v]) => [k, { rls: v.rls, cols: [...v.cols].sort() }])) });

(async () => {
  // 1) The repo up to production's state
  const up = new PGlite();
  await build((sql) => up.exec(sql), { until: PHASES[0] });
  const before = norm(await manifest(up)), p = norm(prod);
  const diffs = [];
  for (const part of ['tables', 'policies', 'functions', 'table_grants']) {
    for (const k of new Set([...keys(p[part]), ...keys(before[part])])) {
      if (canon(p[part][k]) !== canon(before[part][k])) diffs.push(`${part} ${k}: production ${JSON.stringify(p[part][k])} · repo ${JSON.stringify(before[part][k])}`);
    }
  }
  for (const part of ['triggers', 'buckets', 'realtime']) {
    const a = JSON.stringify([...(p[part] || [])].sort()), b = JSON.stringify([...(before[part] || [])].sort());
    if (a !== b) diffs.push(`${part}: production ${a} · repo ${b}`);
  }
  if (diffs.length) { console.error(diffs.join('\n')); }
  assert.deepEqual(diffs, [], 'the repo before Phase 1 differs from production');
  ok(`The repo's migrations reproduce production exactly: ${keys(p.tables).length} tables, ${keys(p.functions).length} functions, ${keys(p.policies).length} policies, grants, triggers, buckets, realtime`);

  // 2) Phases 1–5, one by one, on top
  for (const ph of PHASES) await up.exec(migration(ph).replace(/create extension if not exists pg_net[^;]*;/gi, ''));
  const after = norm(await manifest(up));
  const changed = [];
  for (const part of ['tables', 'policies', 'functions', 'table_grants']) {
    for (const k of keys(p[part])) {
      if (!(k in after[part])) changed.push(`${part} ${k} disappeared`);
      else if (part === 'tables') {
        const lost = p.tables[k].cols.filter((c) => !after.tables[k].cols.includes(c));
        if (lost.length || p.tables[k].rls !== after.tables[k].rls) changed.push(`table ${k} changed: ${lost.join(', ')}`);
      } else if (canon(p[part][k]) !== canon(after[part][k])) changed.push(`${part} ${k}: ${JSON.stringify(p[part][k])} → ${JSON.stringify(after[part][k])}`);
    }
  }
  for (const part of ['triggers', 'buckets', 'realtime']) for (const x of p[part]) if (!after[part].includes(x)) changed.push(`${part} ${x} disappeared`);
  if (changed.length) console.error(changed.join('\n'));
  assert.deepEqual(changed, [], 'Phases 1–5 change or remove something production has');
  ok('Phases 1–5 change and remove nothing that production has (only additions)');

  const added = {
    tables: keys(after.tables).filter((k) => !(k in p.tables)),
    columns: Object.fromEntries(keys(p.tables).map((k) => [k, after.tables[k].cols.filter((c) => !p.tables[k].cols.includes(c))]).filter(([, v]) => v.length)),
    policies: keys(after.policies).filter((k) => !(k in p.policies)),
    functions: Object.fromEntries(keys(after.functions).filter((k) => !(k in p.functions)).map((k) => [k, after.functions[k]])),
    table_grants: Object.fromEntries(keys(after.table_grants).filter((k) => !(k in p.table_grants)).map((k) => [k, after.table_grants[k]])),
    triggers: after.triggers.filter((x) => !p.triggers.includes(x)),
    buckets: after.buckets.filter((x) => !p.buckets.includes(x)),
    realtime: after.realtime.filter((x) => !p.realtime.includes(x)),
  };
  fs.mkdirSync(path.join(__dirname, '../.impeccable/review'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../.impeccable/review/phase6-additions.json'), JSON.stringify(added, null, 1));
  // What production must show after Phases 1–5 (run tests/lib/manifest.sql there and compare)
  const expected = JSON.parse(canon({ ...after, triggers: [...after.triggers].sort(), buckets: [...after.buckets].sort(), realtime: [...after.realtime].sort() }));
  fs.writeFileSync(path.join(__dirname, 'fixtures/expected-manifest-after-phase5.json'), JSON.stringify(expected, null, 1) + '\n');

  // 3) What they add is locked down
  for (const t of added.tables) assert.equal(after.tables[t].rls, true, t + ' without RLS');
  assert.deepEqual(Object.keys(added.table_grants).filter((k) => k.endsWith(':anon')), [], 'a new table open to anon');
  for (const [k, g] of Object.entries(added.table_grants)) assert(!/INSERT|UPDATE|DELETE|TRUNCATE/.test(g), k + ' can be written from the browser: ' + g);
  for (const [k, f] of Object.entries(added.functions)) {
    assert.equal(f.anon, false, k + ' can be run by anon');
    assert.equal(f.config, 'search_path=""', k + ' without an empty search_path');
  }
  ok(`Additions locked down: ${added.tables.length} tables with RLS and no anon access, no new browser writes, ${Object.keys(added.functions).length} functions none runnable by anon, all with an empty search_path`);

  // 4) Fresh install = upgrade
  const fresh = new PGlite();
  await build((sql) => fresh.exec(sql));
  const f = norm(await manifest(fresh));
  for (const part of ['triggers', 'buckets', 'realtime']) { f[part] = [...f[part]].sort(); after[part] = [...after[part]].sort(); }
  assert.equal(canon(f), canon(after));
  ok(`A fresh install and the upgrade from production end up identical (${migrationFiles().length} migrations)`);
  // 5) The rollback script takes the upgrade back to production (the two buckets stay, as it says)
  await up.exec(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name) values ('d0000000-0000-0000-0000-000000000001','R1',current_date,'10:00 - 12:00','Web','Kept')`);
  await up.exec(fs.readFileSync(path.join(__dirname, '../supabase/rollback/20261111_phases_1-5_down.sql'), 'utf8'));
  const back = norm(await manifest(up));
  back.buckets = back.buckets.filter((b) => !added.buckets.includes(b));
  for (const part of ['triggers', 'buckets', 'realtime']) { back[part] = [...back[part]].sort(); p[part] = [...p[part]].sort(); }
  assert.equal(canon(back), canon(p));
  assert.equal((await up.query("select count(*)::int n from public.cdf_orders where num = 'R1'")).rows[0].n, 1);
  ok('The rollback script takes the database back to exactly what production is today, keeping orders');

  console.log(JSON.stringify({ added_tables: added.tables, added_columns: added.columns, added_buckets: added.buckets, added_functions: Object.keys(added.functions).length, added_policies: added.policies.length }));
})().catch((e) => { console.error(e.message); process.exit(1); });
