// Delivery fee (22/11/2026, test branch paymongo-solicitudes): the shop's own fixed price by distance band, shown to
// the customer in the request form and suggested to admins in the order editor. Not Lalamove's live price, which
// changes with traffic and peak hours: the bands come from Lalamove Manila's public rates (motorcycle ₱50 + ₱5–6.50/km,
// car ₱100 + ₱15–18/km) at the end of each band, plus about 25%, rounded. To be reviewed against real Lalamove costs.
// Distance: straight line from the nearest shop × roadFactor (roads are longer than the straight line).
// Override in config.js: deliveryFees: { roadFactor, maxKm, motorcycle: [[upToKm, pesos], …], car: [[upToKm, pesos], …] }
(() => {
  const DEFAULTS = {
    roadFactor: 1.3, maxKm: 30,
    motorcycle: [[5, 100], [10, 140], [15, 180], [20, 210], [30, 270]],
    car: [[5, 240], [10, 330], [15, 420], [20, 520], [30, 710]],
  };
  const cfg = () => ({ ...DEFAULTS, ...((window.CDF_CONFIG || {}).deliveryFees || {}) });
  const straightKm = (a, b) => {
    const r = (x) => (x * Math.PI) / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };
  // The fee for a straight-line distance: { roadKm, motorcycle, car } in pesos, or far: true past the last band
  const forKm = (km) => {
    const c = cfg(), road = Number(km) * c.roadFactor;
    if (!Number.isFinite(road) || road < 0) return null;
    if (road > c.maxKm) return { roadKm: road, far: true };
    const band = (tiers) => (tiers.find(([upTo]) => road <= upTo) || [])[1] ?? null;
    return { roadKm: road, far: false, motorcycle: band(c.motorcycle), car: band(c.car) };
  };
  // The nearest shop to a point (open that day first) and its fee. shops: [{ branch, lat, lng, available }]
  const forPoint = (point, shops) => {
    if (!point || !Number.isFinite(+point.lat) || !Number.isFinite(+point.lng)) return null;
    const list = (shops || []).filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lng))
      .map((s) => ({ ...s, km: straightKm(point, s) }))
      .sort((a, b) => ((b.available !== false) - (a.available !== false)) || a.km - b.km);
    if (!list.length) return null;
    const fee = forKm(list[0].km);
    return fee && { ...fee, branch: list[0].branch, km: list[0].km };
  };
  window.CDFDeliveryFee = { forKm, forPoint, straightKm };
})();
