// Viewer preferences (language, light/dark, text size) and the Spanish / English texts.
// Spanish / English texts. Static HTML uses data-i18n (text), data-i18n-ph (placeholder) and data-i18n-aria (aria-label).
const I18N = {
  es: {
    signIn: "Inicia sesión", signInTitle: "Entrar en Pedidos", email: "Email", password: "Contraseña", enter: "Entrar", logout: "Salir",
    badLogin: "Email o contraseña incorrectos.", tabOrders: "Pedidos", tabTeam: "Equipo",
    noAccess: "Sin acceso", noAccessTxt: "La cuenta {email} no está en el equipo de Casa de Flores. Pide a un admin que te añada.",
    subAdmin: "Admin · {name}", subVendor: "{name} · tus pedidos",
    prevMonth: "Mes anterior", nextMonth: "Mes siguiente", today: "Hoy", newOrder: "+ Nuevo pedido",
    flowHint: "Preparing → Ready → In transit → Delivered. Un toque en el paso lo marca.",
    purge: "Borrar entregados ({n})", purgeAsk: "¿Borrar {n} pedidos entregados y sus fotos? Sus enlaces de seguimiento dejarán de funcionar.",
    yesDelete: "Sí, borrar", cancel: "Cancelar", purgeFail: "No se pudieron borrar", purged: "{n} pedidos borrados",
    dow: ["L", "M", "X", "J", "V", "S", "D"], nOrders: "{n} pedidos", oneOrder: "1 pedido",
    noOrdersDay: "Sin pedidos este día", emptyAdmin: "Pulsa «+ Nuevo pedido» para añadir uno desde la captura del cliente.",
    emptyVendor: "Cuando te asignen un pedido para este día aparecerá aquí.",
    noPhotoShort: "sin foto", noAddress: "Sin dirección", unassigned: "Sin asignar", loadFail: "No se pudieron cargar los pedidos",
    statusFail: "No se pudo cambiar el estado",
    close: "Cerrar", order: "Pedido #{num}", loadingPhoto: "Cargando foto…", noPhoto: "Sin foto", photoFail: "No se pudo cargar la foto",
    photoAlt: "Foto del pedido", dateSlot: "Fecha y franja", customer: "Cliente", noName: "Sin nombre", address: "Dirección",
    channel: "Canal", noChannel: "Sin canal", note: "Nota / instrucción", noNotes: "Sin notas", photo: "Foto", status: "Estado",
    namePh: "Quién recibe las flores", addrPh: "Calle, número, piso, ciudad", notesPh: "Mensaje de la tarjeta, teléfono, instrucciones…",
    pasteHint: "Pega la captura con Ctrl+V / ⌘V, arrástrala aquí o", changePhoto: "Cambiar foto", uploadPhoto: "Subir foto", remove: "Quitar",
    notImage: "Ese archivo no es una imagen. Usa una foto o una captura de pantalla.", converting: "Convirtiendo foto de iPhone…",
    readFail: "No se pudo leer esa imagen. Prueba a hacerle una captura de pantalla y pegarla.",
    linkAfterSave: "El enlace para el cliente aparece al guardar el pedido.", copied: "Enlace copiado", selectCopy: "Selecciónalo y cópialo",
    copy: "Copiar", view: "Ver", save: "Guardar", askDelete: "¿Borrar el pedido #{num}? No se puede deshacer.", deleteFail: "No se pudo borrar",
    deleted: "Pedido borrado", dupNum: "Ya existe un pedido #{num}. Usa otro número.", saveFail: "No se pudo guardar: {msg}",
    photoUploadFail: "Pedido guardado, pero la foto no se pudo subir", created: "Pedido creado", saved: "Pedido guardado",
    newOrderTitle: "Nuevo pedido", editOrder: "Editar pedido #{num}", date: "Fecha", slot: "Franja horaria", orderNum: "Nº pedido",
    customerName: "Nombre del cliente (opcional)", deliveryAddr: "Dirección de entrega (opcional)", vendor: "Vendedor",
    customerLink: "Enlace para el cliente", delete: "Borrar", openMaps: "Abrir en Google Maps ↗",
    addPerson: "Añadir persona", name: "Nombre", role: "Rol", roleVendor: "Vendedor", initialPass: "Contraseña inicial", passPh: "Mínimo 8 caracteres",
    addHint: "Pásale el email y esta contraseña. Si ya tenía cuenta en este proyecto, conserva la suya.", add: "Añadir",
    team: "Equipo", teamSub: "Los vendedores solo ven los pedidos que tienen asignados.", you: "Tú", confirmRemove: "¿Quitar? Confirmar",
    removeFail: "No se pudo quitar", removed: "{name} ya no tiene acceso", addFail: "No se pudo añadir",
    addedExisting: "{name} añadido (ya tenía cuenta, usa su contraseña)", added: "{name} añadido",
    trackSub: "Seguimiento de tu pedido", loadingOrder: "Cargando tu pedido…", notFound: "No encontramos este pedido",
    notFoundTxt: "Revisa que el enlace esté completo o escríbenos por el mismo canal donde hiciste tu compra.",
    autoRefresh: "Esta página se actualiza sola cuando cambia el estado.", updated: "Actualizado {when}",
    pending: "Pendientes", noneFiltered: "Nada con este filtro", showAll: "Ver todos", lightMode: "Modo claro", darkMode: "Modo oscuro", bigText: "Letra más grande",
    deliveryNote: "Nota para el cliente", deliveryNotePh: "Ej.: No había nadie, volvemos mañana de 12 a 16", deliveryNoteHint: "El cliente la ve en su enlace de seguimiento.",
    proofPhoto: "Foto de prueba", proofHint: "Foto de la puerta o del ramo entregado", phone: "Teléfono (opcional)", emailOpt: "Email (opcional)",
    notify: "Avisar al cliente", deliverySection: "Entrega: nota y foto de prueba",
    msgPrep: "Hola{name}, estamos preparando tu pedido #{num} de Casa de Flores. Síguelo aquí: {link}",
    msgReady: "Hola{name}, tu pedido #{num} de Casa de Flores está listo. Síguelo aquí: {link}",
    msgTransit: "Hola{name}, tu pedido #{num} de Casa de Flores va de camino. Síguelo aquí: {link}",
    msgDone: "Hola{name}, tu pedido #{num} de Casa de Flores se ha entregado. ¡Gracias! {link}",
    msgFail: "Hola{name}, hemos intentado entregar tu pedido #{num} de Casa de Flores pero no había nadie. Más información: {link}",
    mailSubject: "Tu pedido #{num} · Casa de Flores", needEmail: "Añade el email del cliente primero", copyMsg: "Copiar mensaje", msgLang: "Idioma del mensaje", msgCopied: "Mensaje copiado",
    settings: "Ajustes", language: "Idioma", textSize: "Tamaño de letra", normal: "Normal", large: "Grande", theme: "Modo", light: "Claro", dark: "Oscuro", auto: "Auto",
    failedTitle: "No pudimos entregarlo", failedTxt: "Hemos pasado por la dirección y no había nadie. Te contactaremos para volver a intentarlo.",
    stepTxt: ["Estamos preparando tu ramo", "Tu ramo está listo para salir", "Tu ramo va de camino", "Entregado. ¡Gracias por tu compra!"],
  },
  en: {
    signIn: "Sign in", signInTitle: "Sign in to Orders", email: "Email", password: "Password", enter: "Sign in", logout: "Sign out",
    badLogin: "Wrong email or password.", tabOrders: "Orders", tabTeam: "Team",
    noAccess: "No access", noAccessTxt: "The account {email} isn't on the Casa de Flores team. Ask an admin to add you.",
    subAdmin: "Admin · {name}", subVendor: "{name} · your orders",
    prevMonth: "Previous month", nextMonth: "Next month", today: "Today", newOrder: "+ New order",
    flowHint: "Preparing → Ready → In transit → Delivered. Tap a step to set it.",
    purge: "Delete delivered ({n})", purgeAsk: "Delete {n} delivered orders and their photos? Their tracking links will stop working.",
    yesDelete: "Yes, delete", cancel: "Cancel", purgeFail: "Couldn't delete them", purged: "{n} orders deleted",
    dow: ["M", "T", "W", "T", "F", "S", "S"], nOrders: "{n} orders", oneOrder: "1 order",
    noOrdersDay: "No orders this day", emptyAdmin: "Press “+ New order” to add one from the customer's screenshot.",
    emptyVendor: "Orders assigned to you for this day will show up here.",
    noPhotoShort: "no photo", noAddress: "No address", unassigned: "Unassigned", loadFail: "Couldn't load the orders",
    statusFail: "Couldn't change the status",
    close: "Close", order: "Order #{num}", loadingPhoto: "Loading photo…", noPhoto: "No photo", photoFail: "Couldn't load the photo",
    photoAlt: "Order photo", dateSlot: "Date and time slot", customer: "Customer", noName: "No name", address: "Address",
    channel: "Channel", noChannel: "No channel", note: "Note / instructions", noNotes: "No notes", photo: "Photo", status: "Status",
    namePh: "Who receives the flowers", addrPh: "Street, number, flat, city", notesPh: "Card message, phone, instructions…",
    pasteHint: "Paste the screenshot with Ctrl+V / ⌘V, drop it here or", changePhoto: "Change photo", uploadPhoto: "Upload photo", remove: "Remove",
    notImage: "That file isn't an image. Use a photo or a screenshot.", converting: "Converting iPhone photo…",
    readFail: "Couldn't read that image. Try taking a screenshot of it and pasting that.",
    linkAfterSave: "The customer link appears once the order is saved.", copied: "Link copied", selectCopy: "Select it and copy it",
    copy: "Copy", view: "Open", save: "Save", askDelete: "Delete order #{num}? This can't be undone.", deleteFail: "Couldn't delete it",
    deleted: "Order deleted", dupNum: "Order #{num} already exists. Use another number.", saveFail: "Couldn't save: {msg}",
    photoUploadFail: "Order saved, but the photo couldn't be uploaded", created: "Order created", saved: "Order saved",
    newOrderTitle: "New order", editOrder: "Edit order #{num}", date: "Date", slot: "Time slot", orderNum: "Order no.",
    customerName: "Customer name (optional)", deliveryAddr: "Delivery address (optional)", vendor: "Seller",
    customerLink: "Customer link", delete: "Delete", openMaps: "Open in Google Maps ↗",
    addPerson: "Add person", name: "Name", role: "Role", roleVendor: "Seller", initialPass: "Initial password", passPh: "At least 8 characters",
    addHint: "Give them the email and this password. If they already had an account in this project, they keep theirs.", add: "Add",
    team: "Team", teamSub: "Sellers only see the orders assigned to them.", you: "You", confirmRemove: "Remove? Confirm",
    removeFail: "Couldn't remove them", removed: "{name} no longer has access", addFail: "Couldn't add them",
    addedExisting: "{name} added (they already had an account, use their password)", added: "{name} added",
    trackSub: "Your order tracking", loadingOrder: "Loading your order…", notFound: "We couldn't find this order",
    notFoundTxt: "Check that the link is complete, or message us on the channel where you placed your order.",
    autoRefresh: "This page updates by itself when the status changes.", updated: "Updated {when}",
    pending: "Pending", noneFiltered: "Nothing matches this filter", showAll: "Show all", lightMode: "Light mode", darkMode: "Dark mode", bigText: "Larger text",
    deliveryNote: "Note for the customer", deliveryNotePh: "E.g. Nobody was home, we'll come back tomorrow 12-16", deliveryNoteHint: "The customer sees it on their tracking link.",
    proofPhoto: "Proof photo", proofHint: "Photo of the door or the delivered bouquet", phone: "Phone (optional)", emailOpt: "Email (optional)",
    notify: "Notify the customer", deliverySection: "Delivery: note and proof photo",
    msgPrep: "Hi{name}, we're preparing your Casa de Flores order #{num}. Track it here: {link}",
    msgReady: "Hi{name}, your Casa de Flores order #{num} is ready. Track it here: {link}",
    msgTransit: "Hi{name}, your Casa de Flores order #{num} is on its way. Track it here: {link}",
    msgDone: "Hi{name}, your Casa de Flores order #{num} has been delivered. Thank you! {link}",
    msgFail: "Hi{name}, we tried to deliver your Casa de Flores order #{num} but nobody was home. Details: {link}",
    mailSubject: "Your order #{num} · Casa de Flores", needEmail: "Add the customer's email first", copyMsg: "Copy message", msgLang: "Message language", msgCopied: "Message copied",
    settings: "Settings", language: "Language", textSize: "Text size", normal: "Normal", large: "Large", theme: "Mode", light: "Light", dark: "Dark", auto: "Auto",
    failedTitle: "We couldn't deliver it", failedTxt: "We came to the address and nobody was home. We'll contact you to try again.",
    stepTxt: ["We're preparing your bouquet", "Your bouquet is ready to go", "Your bouquet is on its way", "Delivered. Thank you for your order!"],
  },
};

let LANG = (() => {
  try { const s = localStorage.getItem("cdf-lang"); if (s === "es" || s === "en") return s; } catch {}
  const def = document.documentElement.dataset.defaultLang;
  if (def) return def;
  return (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
})();
const t = (k, vars = {}) => tIn(LANG, k, vars);
// Text in a fixed language (messages to customers in the Philippines go out in English)
const tIn = (lang, k, vars = {}) => {
  const v = I18N[lang][k] ?? I18N.es[k] ?? k;
  return typeof v === "string" ? v.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? "") : v;
};
const locale = () => (LANG === "en" ? "en-PH" : "es-ES");

function applyStatic() {
  document.documentElement.lang = LANG;
  for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
  for (const e of document.querySelectorAll("[data-i18n-ph]")) e.placeholder = t(e.dataset.i18nPh);
  for (const e of document.querySelectorAll("[data-i18n-aria]")) e.setAttribute("aria-label", t(e.dataset.i18nAria));
  for (const b of document.querySelectorAll(".lang button")) b.setAttribute("aria-pressed", String(b.dataset.lang === LANG));
}
function setLang(l) {
  LANG = l;
  try { localStorage.setItem("cdf-lang", l); } catch {}
  applyStatic();
  document.dispatchEvent(new Event("langchange"));
}

// ---------- light / dark and text size ----------
const pref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const savePref = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
function applyPrefs() {
  const root = document.documentElement, th = pref("cdf-theme") || "", sz = pref("cdf-size") || "";
  if (th) root.dataset.theme = th; else delete root.dataset.theme;
  if (sz === "lg") root.dataset.size = "lg"; else delete root.dataset.size;
  for (const b of document.querySelectorAll("button[data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === sz));
  for (const b of document.querySelectorAll("[data-theme-set]")) b.setAttribute("aria-pressed", String(b.dataset.themeSet === th));
}
document.addEventListener("click", (e) => {
  const gear = e.target.closest("[data-settings]");
  const menu = document.querySelector(".settings .menu");
  if (gear) { menu.hidden = !menu.hidden; gear.setAttribute("aria-expanded", String(!menu.hidden)); return; }
  if (menu && !menu.hidden && !e.target.closest(".settings")) { menu.hidden = true; document.querySelector("[data-settings]").setAttribute("aria-expanded", "false"); }
  const l = e.target.closest(".lang button"); if (l) { setLang(l.dataset.lang); applyPrefs(); return; }
  const z = e.target.closest("button[data-size]"); if (z) { savePref("cdf-size", z.dataset.size); applyPrefs(); return; }
  const th = e.target.closest("button[data-theme-set]"); if (th) { savePref("cdf-theme", th.dataset.themeSet); applyPrefs(); }
});
document.addEventListener("keydown", (e) => { const m = document.querySelector(".settings .menu"); if (e.key === "Escape" && m && !m.hidden) m.hidden = true; });
applyStatic();
applyPrefs();
