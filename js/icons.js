// Line icons (24px grid, drawn with currentColor) and the channel marks from Simple Icons (img/channels/SOURCES.md).
const ICONS = {
  web: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6m-6 4h6"/>',
  team: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4c2 1 3 2 3 5v2"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
  flower: '<path d="M12 21v-9m0 5c-5 0-7-2-7-5 5 0 7 2 7 5Zm0-3c4 0 6-2 6-5-4 0-6 2-6 5Z"/><path d="M12 12C4 12 4 4 8 5c0-5 8-5 8 0 4-1 4 7-4 7Z"/>',
  truck: '<path d="M2 5h12v13H2V5Zm12 4h4l4 5v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10v10M3 7l9 5 9-5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
  note: '<path d="M5 3h14v18H5V3Zm3 5h8m-8 4h8m-8 4h5"/>',
  message: '<path d="M21 11a9 9 0 0 1-9 9H4l-3 3 2-8a9 9 0 1 1 18-4Z"/><path d="M7 11h1m4 0h1m4 0h1"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  map: '<path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15"/>',
  phone: '<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-9 4h4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="var(--surface)"/><circle cx="15" cy="17" r="2.5" fill="var(--surface)"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  timeline: '<path d="M6 4v16"/><circle cx="6" cy="8" r="1.5"/><path d="M10 8h10M10 16h10"/><circle cx="6" cy="16" r="1.5"/>',
  rows: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8m0 0h-5m5 0v5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
};
// Laid out like text inside its parent (display: contents), so buttons and labels need no wrapper rules
const icon = (name, cls = "i") => {
  const span = el("span", { class: "svg-icon", "aria-hidden": "true" });
  span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24">` + (ICONS[name] || ICONS.arrow) + "</svg>";
  return span;
};
// Channels: brand colour (shown only when chosen or filtered) and logo; Web has none, so it uses the globe
const CHANNEL_LOGO = { Shopify: "/img/channels/shopify.svg", Instagram: "/img/channels/instagram.svg", TikTok: "/img/channels/tiktok.svg" };
const chanColor = (c) => "var(--" + String(c).toLowerCase() + ")";
const chanMark = (c) => (CHANNEL_LOGO[c] ? el("img", { src: CHANNEL_LOGO[c], alt: "" }) : icon("web"));
function chanChip(c) {
  if (!c) return null;
  return el("span", { class: "chan" }, el("i", { style: "--cc:" + chanColor(c) }, chanMark(c)), c);
}
