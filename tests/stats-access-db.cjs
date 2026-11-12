// Statistics only for chosen admins (migration 20261112110000): who can switch it, for whom.
// NODE_PATH=.test-tools/node_modules node tests/stats-access-db.cjs
const { PGlite } = require('@electric-sql/pglite');
const assert = require('assert');
const { build, TEAM, claims } = require('./lib/fresh-db.cjs');
const ok = (n) => console.log('ok ' + n);
(async () => {
  const db = new PGlite();
  await build((sql) => db.exec(sql));
  await db.exec(TEAM + `insert into public.cdf_members(email,name,role) values ('admin3@t','Admin Three','admin');`);
  const as = async (email) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [claims(email)]); await db.exec('set role authenticated'); };
  const set = (email, v) => db.query('update public.cdf_members set sees_stats = $2 where email = $1', [email, v]);
  const sees = async (email) => { await db.exec('reset role'); return (await db.query('select sees_stats from public.cdf_members where email = $1', [email])).rows[0].sees_stats; };

  assert.deepEqual((await db.query('select distinct sees_stats from public.cdf_members')).rows, [{ sees_stats: true }]);
  ok('Everyone keeps Statistics until someone is switched off');

  await as('admin@t'); await set('admin2@t', false);
  assert.equal(await sees('admin2@t'), false);
  await as('admin@t'); await assert.rejects(set('admin@t', false), /cdf_stats_own/);
  ok('An admin with Statistics switches another admin off; never themselves');

  await as('admin2@t'); await assert.rejects(set('admin2@t', true), /cdf_stats_own/);
  await as('admin2@t'); await assert.rejects(set('admin3@t', false), /cdf_stats_forbidden/);
  // Other edits by that admin still work
  await as('admin2@t'); await db.query("update public.cdf_members set name = 'Admin 3' where email = 'admin3@t'");
  assert.equal(await sees('admin3@t'), true);
  ok('An admin without Statistics cannot switch themselves on nor anyone else; their other edits still work');

  await as('flo@t'); const r = await db.query("update public.cdf_members set sees_stats = false where email = 'admin@t'");
  assert.equal(r.affectedRows ?? 0, 0); assert.equal(await sees('admin@t'), true);
  ok('A florist changes nothing');

  await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await set('admin2@t', true);
  assert.equal(await sees('admin2@t'), true);
  ok('The database itself (no session) is not limited');
})().catch((e) => { console.error(e); process.exit(1); });
