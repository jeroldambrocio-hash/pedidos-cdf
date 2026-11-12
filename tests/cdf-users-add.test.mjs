// Audit F04: cdf-users as a whole (handler.ts, the same code index.ts serves). Two admins add the same email
// at the same moment: one is added, the other is told, and nothing is overwritten. The database and the
// accounts service are stand-ins that answer after a pause, so the two requests really interleave.
// Run: node --experimental-strip-types tests/cdf-users-add.test.mjs
import assert from "node:assert";
import { handleUsers } from "../supabase/functions/cdf-users/handler.ts";
const ok = (m) => console.log("ok " + m);
const later = (v) => new Promise((r) => setTimeout(() => r(v), 5));

function world() {
  const members = [{ email: "admin@t", name: "Admin", role: "admin", sees_stats: true }, { email: "admin2@t", name: "Second", role: "admin", sees_stats: true }];
  const accounts = new Set(), writes = [];
  const from = (table) => {
    assert.equal(table, "cdf_members");
    const st = { filters: [] };
    const chain = {
      select() { return chain; }, eq(k, v) { st.filters.push([k, v]); return chain; },
      maybeSingle: () => later().then(() => ({ data: members.find((m) => st.filters.every(([k, v]) => m[k] === v)) ?? null, error: null })),
      // As the table does it: the email is its key and usernames are unique
      insert: (row) => later().then(() => {
        writes.push("insert");
        if (members.some((m) => m.email === row.email || (row.username && m.username === row.username))) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        members.push({ ...row }); return { error: null };
      }),
      upsert: (row) => later().then(() => { writes.push("upsert"); const i = members.findIndex((m) => m.email === row.email); if (i < 0) members.push({ ...row }); else members[i] = { ...members[i], ...row }; return { error: null }; }),
    };
    return chain;
  };
  const service = { from,
    auth: { getUser: (token) => later({ data: { user: { email: token } }, error: null }),
      admin: { createUser: ({ email }) => later().then(() => accounts.has(email) ? { error: { message: "A user with this email address has already been registered" } } : (accounts.add(email), { data: {}, error: null })) } } };
  const add = async (as, body) => {
    const res = await handleUsers(new Request("https://x/cdf-users", { method: "POST", headers: { Authorization: "Bearer " + as, "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", password: "long-enough", ...body }) }), { service, env: () => undefined });
    return { status: res.status, ...(await res.json()) };
  };
  return { members, accounts, writes, add };
}

{ const w = world();
  const [a, b] = await Promise.all([w.add("admin@t", { email: "new@t.co", name: "Ana", role: "vendor" }), w.add("admin2@t", { email: "NEW@t.co", name: "Someone Else", role: "admin" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const lost = a.status === 409 ? a : b;
  assert.equal(lost.code, "email_taken"); assert.equal(lost.name, "Ana");
  const rows = w.members.filter((m) => m.email === "new@t.co");
  assert.equal(rows.length, 1); assert.equal(rows[0].name, "Ana"); assert.equal(rows[0].role, "vendor");
  assert.equal(w.writes.includes("upsert"), false); }
ok("Two admins add the same email at once: one is added, the other gets “already a member”; name and role are the first one's (the audit's case answered 200 to both and kept the second's)");

{ const w = world();
  assert.equal((await w.add("admin@t", { email: "new@t.co", name: "Ana", role: "vendor" })).status, 200);
  const again = await w.add("admin2@t", { email: "new@t.co", name: "Other", role: "admin" });
  assert.equal(again.status, 409); assert.equal(again.code, "email_taken");
  assert.equal(w.members.find((m) => m.email === "new@t.co").role, "vendor"); }
ok("One after the other, as before: the second is refused and changes nothing");

{ const w = world();
  const [a, b] = await Promise.all([w.add("admin@t", { email: "one@t.co", name: "One", username: "flor" }), w.add("admin2@t", { email: "two@t.co", name: "Two", username: "flor" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.match((a.status === 409 ? a : b).error, /Username already taken/);
  assert.equal(w.members.filter((m) => m.username === "flor").length, 1); }
ok("Two different people given the same username at once: one keeps it, the other is told it is taken");

{ const w = world(); w.accounts.add("shared@t.co"); // a login that already exists in this project (the other app's)
  const r = await w.add("admin@t", { email: "shared@t.co", name: "Shared", role: "vendor" });
  assert.equal(r.status, 200); assert.equal(r.existed, true); assert.equal(w.members.some((m) => m.email === "shared@t.co"), true); }
ok("An account that already exists in the project still gets access, keeping its password");

{ const w = world(); w.members.push({ email: "flo@t", name: "Flo", role: "vendor" });
  assert.equal((await w.add("flo@t", { email: "x@t.co", name: "X" })).status, 403); assert.equal(w.accounts.size, 0); }
ok("Only an admin can add people");
