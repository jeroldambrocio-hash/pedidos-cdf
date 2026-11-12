// The team function (cdf-users) adds and removes people with the service identity, which the database does not
// limit, so it applies the Statistics rule itself (second review of PR #18).
// Run: node --experimental-strip-types tests/cdf-users-stats.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { hasStats, mayRemove, statsOnAdd } from "../supabase/functions/cdf-users/stats.ts";
const ok = (m) => console.log("ok " + m);
const withStats = { role: "admin", sees_stats: true }, without = { role: "admin", sees_stats: false };

assert.deepEqual(statsOnAdd(without), { sees_stats: false });
assert.deepEqual(statsOnAdd(withStats), {});
assert.deepEqual(statsOnAdd({ role: "admin" }), {}); // before the migration: the column is missing, everyone has it
ok("An admin without Statistics adds people without them; one with them leaves the default");

assert.equal(mayRemove(without, withStats), false);
assert.equal(mayRemove(without, without), true);
assert.equal(mayRemove(without, { role: "vendor", sees_stats: true }), true);
assert.equal(mayRemove(withStats, withStats), true);
assert.equal(hasStats({ role: "vendor", sees_stats: true }), false);
ok("An admin without Statistics cannot remove an admin who has them; anyone else as before");

const src = readFileSync(new URL("../supabase/functions/cdf-users/index.ts", import.meta.url), "utf8");
assert.match(src, /upsert\(\{ email, name, role, \.\.\.statsOnAdd\(me\)/);
assert.match(src, /if \(!mayRemove\(me, target\)\) return json\(/);
assert.ok(src.indexOf("mayRemove(me, target)") < src.indexOf('.delete().eq("email", email)'));
ok("The function uses both rules before writing with the service identity");
