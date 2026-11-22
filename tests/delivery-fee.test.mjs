// Delivery fee bands (js/delivery-fee.js): nearest shop, road factor, band edges, far away, config override.
// Run: node tests/delivery-fee.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
const load = (cfg) => { const window = { CDF_CONFIG: cfg }; new Function("window", readFileSync(new URL("../js/delivery-fee.js", import.meta.url), "utf8"))(window); return window.CDFDeliveryFee; };
const F = load({});
const shops = [{ branch: "Parañaque", lat: 14.46477, lng: 121.02237 }, { branch: "Pasig", lat: 14.5523, lng: 121.07725 }, { branch: "Quezon City", lat: 14.65534, lng: 121.01544 }];
assert.deepEqual(F.forKm(0), { roadKm: 0, far: false, motorcycle: 100, car: 240 });
assert.equal(F.forKm(5 / 1.3).motorcycle, 100, "exactly 5 km by road is still the first band");
assert.equal(F.forKm(5.01 / 1.3).motorcycle, 140);
assert.equal(F.forKm(30 / 1.3).motorcycle, 270);
assert.equal(F.forKm(30.1 / 1.3).far, true);
const makati = F.forPoint({ lat: 14.561862, lng: 121.015376 }, shops);
assert.equal(makati.branch, "Pasig"); assert.equal(makati.motorcycle, 140); assert.equal(makati.car, 330);
assert.equal(F.forPoint({ lat: 14.4195, lng: 121.045 }, shops).branch, "Parañaque", "Alabang → Parañaque");
assert.equal(F.forPoint({ lat: 14.4195, lng: 121.045 }, shops.map((s) => ({ ...s, available: s.branch !== "Parañaque" }))).branch, "Pasig", "a shop closed that day is skipped");
assert.equal(F.forPoint(null, shops), null); assert.equal(F.forPoint({ lat: 14.5, lng: 121 }, []), null);
const custom = load({ deliveryFees: { roadFactor: 1, motorcycle: [[5, 90], [30, 200]], car: [[5, 200], [30, 400]] } });
assert.deepEqual(custom.forKm(6), { roadKm: 6, far: false, motorcycle: 200, car: 400 }, "config.js can change the prices");
console.log("ok delivery fee: bands, nearest open shop, far away, config override");
