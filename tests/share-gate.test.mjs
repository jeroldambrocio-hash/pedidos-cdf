// node tests/share-gate.test.mjs — what the public test link lets through to the local Supabase
import assert from "node:assert/strict";
import { refusal } from "../scripts/share-gate.mjs";

const jwt = (role) => "x." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".y";
const ok = (url, h = {}) => assert.equal(refusal("GET", url, h), null, url);
const no = (url, h = {}) => assert.notEqual(refusal("GET", url, h), null, url);

ok("/rest/v1/cdf_requests?select=*", { apikey: jwt("anon") });
ok("/auth/v1/token?grant_type=password", { apikey: jwt("anon") });
ok("/rest/v1/cdf_members", { apikey: jwt("anon"), authorization: "Bearer " + jwt("authenticated") });
ok("/storage/v1/object/public/x.jpg");
ok("/realtime/v1/websocket?apikey=" + jwt("anon") + "&vsn=1.0.0");
ok("/functions/v1/cdf-paymongo");                     // PayMongo's webhook carries no Supabase key
no("/rest/v1/cdf_members", { apikey: jwt("service_role") });
no("/rest/v1/cdf_members", { apikey: jwt("anon"), authorization: "Bearer " + jwt("service_role") });
no("/realtime/v1/websocket?apikey=" + jwt("service_role"));
no("/rest/v1/x", { apikey: "sb_secret_abc" });
no("/auth/v1/admin/users", { apikey: jwt("anon") });
no("/pg/tables"); no("/graphql/v1"); no("/"); no("/analytics/v1/x"); no("/rest/v1/../pg/tables");
console.log("share-gate: 15 OK");
