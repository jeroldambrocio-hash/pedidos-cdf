// Phase 4: the shop nearest to a delivery point, suggested to the admin. In-memory database built from every
// migration; never connects to Supabase. Distances are checked against values worked out independently.
// Run: NODE_PATH=.test-tools/node_modules node tests/branch-ranking-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert');
const { build, migration, TEAM, claims } = require('./lib/fresh-db.cjs');

// Haversine in plain JavaScript, to check the database's figures
const km = (a, b) => {
  const r = (d) => (d * Math.PI) / 180, R = 6371;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
};

(async () => {
  const db = new PGlite();
  const ok = (m) => console.log('ok ' + m);
  const as = async (who) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [who ? claims(who) : '']);
    await db.exec('set role ' + (who ? 'authenticated' : 'anon'));
  };
  await build((sql) => db.exec(sql), { until: 'cdf_branch_ranking' });
  await db.exec(TEAM);
  // The shops of Metro Manila as Team holds them, plus the cases the ranking must not trust
  const QC = [14.6337, 121.0338], PQ = [14.4793, 121.0198], PS = [14.5764, 121.0851];
  await db.exec(`
    update public.cdf_members set branch = 'Quezon City', pickup_address = '12 Tomas Morato Ave, QC', pickup_lat = ${QC[0]}, pickup_lng = ${QC[1]} where email = 'flo@t';
    insert into public.cdf_members(email, name, role, branch, pickup_address, pickup_lat, pickup_lng, away_from, away_until) values
      ('jhandee@t', 'Jhandee', 'vendor', 'Parañaque', 'BF Homes, Parañaque', ${PQ[0]}, ${PQ[1]}, null, null),
      ('arjay@t', 'Arjay', 'vendor', 'Pasig', 'Kapitolyo, Pasig', ${PS[0]}, ${PS[1]}, current_date + 1, current_date + 3),
      ('agnes@t', 'Agnes', 'vendor', null, null, null, null, null, null),
      ('qc2@t', 'Bea', 'vendor', 'Quezon City', '12 Tomas Morato Ave, QC', ${QC[0]}, ${QC[1]}, null, null),
      ('far@t', 'Far Away', 'vendor', 'Madrid', 'Gran Vía', 40.42, -3.70, null, null),
      ('nobranch@t', 'No Branch', 'vendor', '  ', 'Somewhere', 14.55, 121.02, null, null);`);
  await db.exec(migration('cdf_branch_ranking'));
  ok('The migration adds one function and changes no data');

  const rank = async (lat, lng, date = null) => (await db.query('select public.cdf_branch_ranking($1, $2, $3) r', [lat, lng, date])).rows[0].r;
  for (const who of [null, 'flo@t', 'dri@t']) { await as(who); await assert.rejects(rank(14.6, 121.03), { code: '42501' }, String(who)); }
  ok('Only admins can ask for it');

  await as('admin@t');
  await assert.rejects(rank(40.4, -3.7), /cdf_invalid_point/); await assert.rejects(rank(null, 121), /cdf_invalid_point/);
  ok('A point outside the Philippines, or no point, is refused');

  // Katipunan, Quezon City: Quezon City first, then Pasig, then Parañaque
  const katipunan = [14.6397, 121.0775];
  const r = await rank(...katipunan);
  assert.deepEqual(r.ranked.map((s) => s.branch), ['Quezon City', 'Pasig', 'Parañaque']);
  assert.deepEqual(r.ranked.map((s) => +s.km), [km(katipunan, QC), km(katipunan, PS), km(katipunan, PQ)]);
  ok(`Shops ordered by straight-line distance, figures as worked out independently (${r.ranked.map((s) => s.km + ' km').join(', ')})`);

  assert.deepEqual(r.ranked[0].florists.map((f) => f.name), ['Bea', 'Flo']);
  assert.equal(r.ranked.length, 3);
  ok('Two florists at the same point with the same branch name are one shop');

  assert.deepEqual(r.incomplete.map((f) => [f.name, f.missing]), [['Agnes', ['point', 'branch']], ['Far Away', ['point_outside']], ['No Branch', ['branch']]]);
  assert(!r.ranked.some((s) => s.florists.some((f) => ['agnes@t', 'far@t', 'nobranch@t'].includes(f.email))));
  ok('Florists with no point, no branch or a point abroad are left out of the ranking and listed with the reason');

  // Arjay (Pasig) is away on that date: Pasig drops below the shops that can take it, marked
  const day = (await db.query("select (current_date + 2)::text d")).rows[0].d;
  const r2 = await rank(...katipunan, day);
  assert.deepEqual(r2.ranked.map((s) => [s.branch, s.all_away]), [['Quezon City', false], ['Parañaque', false], ['Pasig', true]]);
  assert.equal(r2.ranked[2].florists[0].away, true);
  const r3 = await rank(...katipunan, (await db.query("select (current_date + 10)::text d")).rows[0].d);
  assert.equal(r3.ranked[1].branch, 'Pasig', 'back in place once the absence is over');
  ok('A shop whose florists are all away that day goes last and says so; it comes back once the absence ends');

  // A shop where only one of two florists is away stays in place, with that one marked
  await db.exec("reset role"); await db.query(`update public.cdf_members set away_from = $1, away_until = $1 where email = 'qc2@t'`, [day]); await as('admin@t');
  const r4 = await rank(...katipunan, day);
  assert.equal(r4.ranked[0].branch, 'Quezon City'); assert.equal(r4.ranked[0].all_away, false);
  assert.deepEqual(r4.ranked[0].florists.map((f) => [f.name, f.away]), [['Flo', false], ['Bea', true]]);
  ok('A shop with one florist away and another in stays first, the available one listed first');

  // A different destination changes the answer: BF Homes is nearest to Parañaque
  assert.equal((await rank(14.4560, 121.0230)).ranked[0].branch, 'Parañaque');
  // A tie: halfway between two shops by the same distance → both, ordered by name, neither hidden
  await db.exec("reset role");
  await db.exec(`insert into public.cdf_members(email, name, role, branch, pickup_lat, pickup_lng) values
    ('t1@t', 'T1', 'vendor', 'East', 14.60000, 121.10000), ('t2@t', 'T2', 'vendor', 'West', 14.60000, 121.00000);`);
  await as('admin@t');
  const tie = (await rank(14.60000, 121.05000)).ranked.filter((s) => ['East', 'West'].includes(s.branch));
  assert.equal(tie[0].km, tie[1].km); assert.deepEqual(tie.map((s) => s.branch), ['East', 'West']);
  ok('Another destination, another answer; a tie keeps both shops, in name order');

  // Conflicts: one name at two points, one point under two names
  await db.exec("reset role");
  await db.exec(`insert into public.cdf_members(email, name, role, branch, pickup_lat, pickup_lng) values
    ('qc3@t', 'Cora', 'vendor', 'quezon city ', 14.65000, 121.05000), ('ps2@t', 'Dina', 'vendor', 'Mandaluyong', ${PS[0]}, ${PS[1]});`);
  await as('admin@t');
  const c = (await rank(...katipunan)).conflicts;
  assert.deepEqual(c.map((x) => x.kind), ['name_many_points', 'point_many_names']);
  assert.deepEqual(c[0].florists, ['Bea', 'Cora', 'Flo']); assert.equal(c[1].label, 'Mandaluyong / Pasig');
  ok('Data that disagrees is pointed out to fix: one branch name at two places, or one place under two names');

  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
