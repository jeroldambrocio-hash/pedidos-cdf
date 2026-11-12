// What's new: the changes made to the app, newest first, shown under the account menu → What's new.
// Add an entry at the top whenever a change reaches the team (one line per change, in plain words, ES and EN).
const CHANGELOG = [
  { date: "2026-11-12",
    es: ["Pago rápido: toca «Pago pendiente» en la tarjeta de un pedido para marcarlo como pagado sin abrirlo (solo admins).",
      "Las fotos de entrega y recogida de Lalamove se abren encima del pedido, sin salir de la app.",
      "Nuevo apartado «Novedades» en el menú con los cambios de la app.",
      "Estadísticas: solo las ven los admins que tengan el permiso activado en Equipo.",
      "Solicitudes: enlace al formulario para clientes, listo para copiar o compartir.",
      "Las solicitudes caducan el día después de la entrega y avisan al equipo."],
    en: ["Quick pay: tap “Payment pending” on an order card to mark it as paid without opening it (admins only).",
      "Lalamove delivery and pickup photos open over the order, without leaving the app.",
      "New “What's new” section in the menu with the app's changes.",
      "Statistics: only admins with the permission switched on in Team can see them.",
      "Requests: the customer form link, ready to copy or share.",
      "Requests expire the day after delivery and the team is told."] },
  { date: "2026-11-11",
    es: ["Formulario público de pedidos con mapa y fotos: el cliente envía una solicitud y un admin la acepta.",
      "Al crear un pedido se guardan a la vez el precio y el anticipo.",
      "Sugerencia de la tienda más cercana al elegir florista.",
      "Lalamove: pruebas de entrega e historial de envíos en cada pedido.",
      "Punto de entrega marcado a mano en el mapa; el canal del pedido es obligatorio."],
    en: ["Public order form with map and photos: the customer sends a request and an admin accepts it.",
      "Creating an order saves the price and the down payment together.",
      "The nearest shop is suggested when choosing the florist.",
      "Lalamove: delivery proofs and booking history on each order.",
      "Drop-off point set by hand on the map; the order channel is required."] },
  { date: "2026-11-10",
    es: ["Las notificaciones se quedan activadas solas en cada dispositivo.",
      "Las floristas ven el calendario con sus pedidos asignados."],
    en: ["Notifications stay on by themselves on every device.",
      "Florists see the calendar with the orders assigned to them."] },
  { date: "2026-11-09",
    es: ["Pagos por partes: cada pago queda en el historial del pedido, con justificantes.",
      "Filtro de pedidos que necesitan atención.",
      "Las floristas piden el rider de Lalamove con «Head out» desde su propia tienda.",
      "Cada persona muestra su sucursal en el perfil y en Equipo."],
    en: ["Payments in parts: each payment is kept in the order history, with proofs.",
      "Filter for orders that need attention.",
      "Florists book the Lalamove rider with “Head out” from their own shop.",
      "Everyone's branch shows on their profile and in Team."] },
];
const CHANGELOG_SEEN = "cdf-changelog-seen";
const changelogUnseen = () => !!CHANGELOG.length && (pref(CHANGELOG_SEEN) || "") < CHANGELOG[0].date;
function paintChangelogDot() {
  const on = changelogUnseen();
  document.querySelectorAll("#accountBtn, #changelogBtn").forEach((b) => b.classList.toggle("has-news", on));
}
function openChangelog() {
  try { localStorage.setItem(CHANGELOG_SEEN, CHANGELOG[0]?.date || ""); } catch {}
  paintChangelogDot();
  const day = (d) => new Intl.DateTimeFormat(LANG, { dateStyle: "long", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const node = el("div", { class: "sheet changelog", role: "dialog", "aria-modal": "true" },
    el("div", { class: "sheet-head" }, el("h2", {}, t("whatsNew")), el("span", { class: "spacer" }), closeBtn()),
    el("div", { class: "sheet-body" }, CHANGELOG.map((e) => el("section", {},
      el("h3", {}, day(e.date)),
      el("ul", { class: "changelog-list" }, (e[LANG] || e.en).map((line) => el("li", {}, line)))))));
  openLayer(node);
}
