// Test copy only: creates the test accounts in the Supabase running on this PC (scripts/supabase-local.sh).
// Refuses to run against anything that is not localhost, so it can never create accounts in production.
//   node scripts/local-test-accounts.mjs
// Passwords are random and written to .secrets/test-accounts.txt (git-ignored), never printed.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const env = Object.fromEntries(readFileSync(".secrets/local-supabase.env", "utf8").split(/\r?\n/).filter(Boolean)
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const api = env.API_URL, key = env.SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api || "")) throw new Error("Not the local Supabase: " + api);
const h = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };

// role: admin = sees Requests (moderator); is_owner = the owner/developer on top of that; vendor = florist; carrier = driver
const people = [
  { username: "admin", name: "Admin", role: "admin", is_owner: true, sees_stats: true },
  { username: "moderador", name: "Moderador (prueba)", role: "admin", is_owner: false, sees_stats: false },
  { username: "florista", name: "Florista (prueba)", role: "vendor", branch: "Pasig", pickup_lat: 14.5523, pickup_lng: 121.07725, pickup_address: "Pasig (prueba)" },
  { username: "repartidor", name: "Repartidor (prueba)", role: "carrier" },
];
const lines = ["Test accounts (local Supabase only). Sign in with the username and this password.", ""];
for (const p of people) {
  const email = p.username + "@cdf-test.invalid", password = randomBytes(9).toString("base64url");
  let r = await fetch(api + "/auth/v1/admin/users", { method: "POST", headers: h, body: JSON.stringify({ email, password, email_confirm: true }) });
  if (!r.ok) {
    // Already there from an earlier run: reset its password instead
    const list = await (await fetch(api + "/auth/v1/admin/users?per_page=200", { headers: h })).json();
    const u = (list.users || []).find((x) => x.email === email);
    if (!u) throw new Error("Could not create " + email + ": " + r.status + " " + (await r.text()));
    r = await fetch(api + "/auth/v1/admin/users/" + u.id, { method: "PUT", headers: h, body: JSON.stringify({ password }) });
    if (!r.ok) throw new Error("Could not reset " + email);
  }
  const { username, is_owner, ...member } = p;
  const m = await fetch(api + "/rest/v1/cdf_members?on_conflict=email", { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ email, username, ...member }) });
  if (!m.ok) throw new Error("Could not add member " + username + ": " + m.status + " " + (await m.text()));
  // is_owner can only be set by the database itself (not the API): done with psql inside the local container
  if (is_owner) execFileSync("docker", ["exec", "supabase_db_cdf-paymongo-test", "psql", "-U", "postgres", "-qc", `update public.cdf_members set is_owner = true where email = '${email}'`]);
  lines.push(`${username.padEnd(11)} ${password}   (${p.role}${p.is_owner ? ", owner" : ""})`);
  console.log("ok", username, p.role + (p.is_owner ? " + owner" : ""));
}
// The other two shops (the live app's shop points, no names or addresses), as florists without a login: the request
// form's pickup list and delivery estimate, and the admin's nearest-shop suggestion, need all three
for (const [branch, lat, lng] of [["Parañaque", 14.46477, 121.02237], ["Quezon City", 14.65534, 121.01544]]) {
  const email = "tienda-" + branch.toLowerCase().replace(/[^a-z]/g, "") + "@cdf-test.invalid";
  const m = await fetch(api + "/rest/v1/cdf_members?on_conflict=email", { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ email, name: "Tienda " + branch + " (prueba)", role: "vendor", branch, pickup_lat: lat, pickup_lng: lng, pickup_address: branch + " (prueba)" }) });
  if (!m.ok) throw new Error("Could not add shop " + branch + ": " + m.status + " " + (await m.text()));
}
writeFileSync(".secrets/test-accounts.txt", lines.join("\n") + "\n");
console.log("Passwords saved in .secrets/test-accounts.txt");
