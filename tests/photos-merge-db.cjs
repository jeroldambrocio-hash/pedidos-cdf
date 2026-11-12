// Audit F12 (migration 20261112180000): two editors that opened the same order each save their own photo
// changes; nothing is lost. In-memory database built from every migration.
// Run: NODE_PATH=.test-tools/node_modules node tests/photos-merge-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');
(async () => {
  const db = new PGlite(), ok = (m) => console.log('ok ' + m);
  await build((sql) => db.exec(sql)); await db.exec(TEAM);
  const id = 'c0000000-0000-0000-0000-000000000001', P = (n) => `${id}/${n}.jpg`;
  await db.query(`insert into public.cdf_orders(id,num,date,slot,channel,customer_name,vendor_email,extra_photos) values ($1,'0900',current_date,'10:00 - 11:00','Web','Ana','flo@t',$2)`, [id, [P('original')]]);
  const as = async (who, add, remove) => {
    await db.query("select set_config('request.jwt.claims',$1,false)", [who ? claims(who) : '']); await db.exec('set role ' + (who ? 'authenticated' : 'anon'));
    try { return (await db.query('select (public.cdf_order_photos_merge($1,$2,$3)).extra_photos p', [id, add, remove])).rows[0].p; }
    finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
  };
  // Both opened with [original]; each adds one
  await as('admin@t', [P('A')], []);
  assert.deepEqual(await as('admin2@t', [P('B')], []), [P('original'), P('A'), P('B')]);
  ok('Two editors each add a photo: both stay (the audit\'s case kept only the second)');
  // One removes the original while the other, still seeing it, adds another
  await as('admin@t', [], [P('original')]);
  assert.deepEqual(await as('admin2@t', [P('C')], []), [P('A'), P('B'), P('C')]);
  ok('A removal by one is not undone by the other\'s later save');
  assert.deepEqual(await as('admin@t', [P('C')], [P('nope')]), [P('A'), P('B'), P('C')]);
  ok('Adding one already there or removing one that is not changes nothing');
  await assert.rejects(as('admin@t', ['other-order/x.jpg'], []), /cdf_photo_path/);
  await assert.rejects(as('admin@t', Array.from({ length: 10 }, (_, i) => P('n' + i)), []), /cdf_photo_limit/);
  assert.equal((await db.query('select cardinality(extra_photos) n from public.cdf_orders where id = $1', [id])).rows[0].n, 3);
  ok('Only files in the order\'s own folder; never more than 12 (a refused change leaves the list as it was)');
  await assert.rejects(as('flo@t', [P('F')], []), /order not found/);
  await assert.rejects(as(null, [P('F')], []), /permission denied/);
  ok('Same rights as editing the order: not a florist, not a visitor');
  console.log('all photo merge checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
