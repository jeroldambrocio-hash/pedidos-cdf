// Viewer preferences (language, light/dark, text size) and the Spanish / English texts.
// Spanish / English texts. Static HTML uses data-i18n (text), data-i18n-ph (placeholder) and data-i18n-aria (aria-label).
const I18N = {
  es: {
    missedBanner: "No había nadie: {n} reprogramado(s) desde este día", retryTag: "Intento {n} · no había nadie el {date}",
    sameAsBuyer: "Es para la misma persona que compra (no es un regalo)", fillRequired: "Rellena los campos marcados con *.", required: "Obligatorio",
    retry: "Reintentar", loadErrTitle: "No se pudo cargar tu pedido", loadErrTxt: "Parece un problema de conexión. Inténtalo de nuevo en un momento.", staleNote: "sin conexión, puede no estar al día", forName: "Para: {name}", bouquetCaption: "Tu ramo antes de salir de nuestro taller",
    recipient: "Para", recipientH: "Para quién", buyerH: "Quién compra", buyerHint: "Recibe los avisos y el correo cuando sale. Pon al menos teléfono o email.",
    buyerNamePh: "Quien hizo el pedido", cardMsg: "Mensaje de la tarjeta", cardPh: "Lo que va escrito en la tarjeta", notifyBuyer: "Avisar a quien compra",
    bouquetPhoto: "Foto del ramo", bouquetHint: "Foto del ramo terminado. El cliente la ve en su enlace.", readyTitle: "Listo · #{num}", confirmReady: "Marcar listo",
    searchPh: "Buscar nº, nombre o teléfono", searchTitle: "Búsqueda: «{q}»", searchNone: "No hay pedidos que coincidan",
    st_prep: "Preparando", st_ready: "Listo", st_transit: "En camino", st_done: "Entregado", st_fail: "No había nadie",
    grpLate: "Atrasados", grpNext: "Próximos días", tomorrow: "Mañana", myRoute: "Mi ruta de hoy", myOrders: "Mis pedidos",
    todayCount: "{n} para hoy", nothingToday: "Nada para hoy", allClear: "Todo al día",
    actReady: "Marcar listo", actOut: "Salgo", actDelivered: "Entregado", actMissed: "No había nadie", call: "Llamar", map: "Mapa",
    outMailed: "En camino. El cliente recibe un correo.", outNoMail: "En camino (el pedido no tiene email del cliente)",
    deliverTitle: "Entregar #{num}", noteOpt: "Nota para el cliente (opcional)", deliveredNotePh: "Ej.: Se lo dejé al portero",
    confirmDelivered: "Confirmar entrega", deliveredOk: "Entregado",
    missedTitle: "No había nadie · #{num}", missedHint: "Haz una foto de la puerta y elige cuándo volver. El pedido vuelve a «Listo» para ese día y el cliente lo ve en su enlace.",
    newDate: "Nueva fecha", newSlot: "Nueva hora", missedNotePh: "Si lo dejas vacío escribimos uno en inglés con la hora y la nueva fecha",
    confirmMissed: "Reprogramar", rescheduled: "Reprogramado para {date}",
    needPhone: "Añade el teléfono del cliente primero", autoMailHint: "Con email, el cliente recibe un correo automático cuando el pedido sale.", moreDetails: "Más detalles",
    signIn: "Inicia sesión", signInTitle: "Entrar en Pedidos", email: "Email", password: "Contraseña", enter: "Entrar", logout: "Salir",
    badLogin: "Email o contraseña incorrectos.", tabOrders: "Pedidos", tabTeam: "Equipo",
    noAccess: "Sin acceso", noAccessTxt: "La cuenta {email} no está en el equipo de Casa de Flores. Pide a un admin que te añada.",
    subAdmin: "Admin · {name}", subVendor: "Florista · {name}", subModerator: "Moderador · {name}", subCarrier: "Repartidor · {name}",
    role_admin: "Admin", role_moderator: "Moderador", role_vendor: "Florista", role_carrier: "Repartidor", phoneShort: "Teléfono",
    emptyCarrier: "Cuando haya pedidos listos para repartir hoy aparecerán aquí.",
    prevMonth: "Mes anterior", nextMonth: "Mes siguiente", today: "Hoy", newOrder: "+ Nuevo pedido",
    flowHint: "Preparando → Listo → En camino → Entregado. El cliente recibe un correo automático cuando sale.",
    purge: "Borrar entregados ({n})", purgeAsk: "¿Borrar {n} pedidos entregados y sus fotos? Sus enlaces de seguimiento dejarán de funcionar.",
    yesDelete: "Sí, borrar", cancel: "Cancelar", purgeFail: "No se pudieron borrar", purged: "{n} pedidos borrados",
    dow: ["L", "M", "X", "J", "V", "S", "D"], nOrders: "{n} pedidos", oneOrder: "1 pedido",
    noOrdersDay: "Sin pedidos este día", emptyAdmin: "Pulsa «+ Nuevo pedido» para añadir uno desde la captura del cliente.",
    emptyVendor: "No tienes pedidos para hoy ni para los próximos días.",
    noPhotoShort: "sin foto", noAddress: "Sin dirección", unassigned: "Sin asignar", loadFail: "No se pudieron cargar los pedidos",
    statusFail: "No se pudo cambiar el estado",
    close: "Cerrar", order: "Pedido #{num}", loadingPhoto: "Cargando foto…", noPhoto: "Sin foto", photoFail: "No se pudo cargar la foto",
    photoAlt: "Foto de referencia", dateSlot: "Fecha y franja", customer: "Cliente", noName: "Sin nombre", address: "Dirección",
    channel: "Canal", noChannel: "Sin canal", note: "Nota / instrucción", noNotes: "Sin notas", photo: "Foto de referencia (qué ramo hacer)", status: "Estado",
    namePh: "Quién recibe las flores", addrPh: "Calle, número, piso, ciudad", notesPh: "Mensaje de la tarjeta, teléfono, instrucciones…",
    pasteHint: "Opcional: el modelo, colores o foto de inspiración que pidió el cliente. Solo la ve el equipo. Pégala con Ctrl+V / ⌘V, arrástrala aquí o", changePhoto: "Cambiar foto", uploadPhoto: "Subir foto", remove: "Quitar",
    notImage: "Ese archivo no es una imagen. Usa una foto o una captura de pantalla.", converting: "Convirtiendo foto de iPhone…",
    readFail: "No se pudo leer esa imagen. Prueba a hacerle una captura de pantalla y pegarla.",
    linkAfterSave: "El enlace para el cliente aparece al guardar el pedido.", copied: "Enlace copiado", selectCopy: "Selecciónalo y cópialo",
    copy: "Copiar", view: "Ver", save: "Guardar", askDelete: "¿Borrar el pedido #{num}? No se puede deshacer.", deleteFail: "No se pudo borrar",
    deleted: "Pedido borrado", dupNum: "Ya existe un pedido #{num}. Usa otro número.", saveFail: "No se pudo guardar: {msg}",
    photoUploadFail: "Pedido guardado, pero la foto no se pudo subir", created: "Pedido creado", saved: "Pedido guardado",
    newOrderTitle: "Nuevo pedido", editOrder: "Editar pedido #{num}", date: "Fecha", slot: "Hora de entrega", orderNum: "Nº pedido",
    customerName: "Nombre", deliveryAddr: "Dirección de entrega", vendor: "Florista",
    customerLink: "Enlace para el cliente", delete: "Borrar", openMaps: "Abrir en Google Maps ↗",
    addPerson: "Añadir persona", name: "Nombre", role: "Rol", roleVendor: "Vendedor", initialPass: "Contraseña inicial", passPh: "Mínimo 8 caracteres",
    addHint: "Pásale el email y esta contraseña. Si ya tenía cuenta en este proyecto, conserva la suya.", add: "Añadir",
    team: "Equipo", teamSub: "Florista: ve sus pedidos de hoy, mañana y la semana. Repartidor: ve las entregas de hoy. Admin: todo.", you: "Tú", confirmRemove: "¿Quitar? Confirmar",
    removeFail: "No se pudo quitar", removed: "{name} ya no tiene acceso", addFail: "No se pudo añadir",
    addedExisting: "{name} añadido (ya tenía cuenta, usa su contraseña)", added: "{name} añadido",
    trackSub: "Seguimiento de tu pedido", loadingOrder: "Cargando tu pedido…", notFound: "No encontramos este pedido",
    notFoundTxt: "Revisa que el enlace esté completo o escríbenos por el mismo canal donde hiciste tu compra.",
    autoRefresh: "Esta página se actualiza sola cuando cambia el estado.", updated: "Actualizado {when}",
    pending: "Pendientes", noneFiltered: "Nada con este filtro", showAll: "Ver todos", lightMode: "Modo claro", darkMode: "Modo oscuro", bigText: "Letra más grande",
    deliveryNote: "Nota para el cliente", deliveryNotePh: "Ej.: No había nadie, volvemos mañana de 12 a 16", deliveryNoteHint: "El cliente la ve en su enlace de seguimiento.",
    proofPhoto: "Foto de prueba", proofHint: "Foto de la puerta o del ramo entregado", phone: "Teléfono", emailOpt: "Email (opcional)",
    notify: "Avisar al cliente", deliverySection: "Entrega: nota y foto de prueba",
    msgPrep: "Hola{name}, estamos preparando tu pedido #{num} de Casa de Flores. Síguelo aquí: {link}",
    msgReady: "Hola{name}, tu pedido #{num} de Casa de Flores está listo. Síguelo aquí: {link}",
    msgTransit: "Hola{name}, tu pedido #{num} de Casa de Flores va de camino. Síguelo aquí: {link}",
    msgDone: "Hola{name}, tu pedido #{num} de Casa de Flores se ha entregado. ¡Gracias! {link}",
    msgFail: "Hola{name}, hemos intentado entregar tu pedido #{num} de Casa de Flores pero no había nadie. Más información: {link}",
    mailSubject: "Tu pedido #{num} · Casa de Flores", needEmail: "Añade el email del cliente primero", copyMsg: "Copiar mensaje", msgLang: "Idioma del mensaje", sending: "Enviando…", mailSent: "Correo enviado a {to}", mailFail: "No se pudo enviar el correo: {msg}", saveFirst: "Guarda el pedido antes de enviar el correo",
    history: "Historial de avisos", histEmpty: "Aún no se ha enviado ningún aviso de este pedido.", histVendor: "Florista", histCustomer: "Cliente", histSent: "enviado", histFailed: "falló", histOpened: "abierto", histNoText: "(sin texto guardado)", histAuto: "Automático",
    slotCustom: "Otra franja…", slotFrom: "Desde", slotTo: "Hasta", slotInvalid: "Elige la hora: «hasta» tiene que ser después de «desde».", msgCopied: "Mensaje copiado",
    settings: "Ajustes", language: "Idioma", textSize: "Tamaño de letra", normal: "Normal", large: "Grande", theme: "Modo", light: "Claro", dark: "Oscuro", auto: "Auto",
    failedTitle: "No pudimos entregarlo", failedTxt: "Hemos pasado por la dirección y no había nadie. Te contactaremos para volver a intentarlo.",
    stepTxt: ["Estamos preparando tu ramo", "Tu ramo está listo para salir", "Tu ramo va de camino", "Entregado. ¡Gracias por tu compra!"],
  },
  en: {
    missedBanner: "Nobody home: {n} rescheduled from this day", retryTag: "Attempt {n} · nobody home on {date}",
    sameAsBuyer: "It's for the buyer themselves (not a gift)", fillRequired: "Fill in the fields marked with *.", required: "Required",
    retry: "Try again", loadErrTitle: "We couldn't load your order", loadErrTxt: "This looks like a connection problem. Please try again in a moment.", staleNote: "offline, may be out of date", forName: "For: {name}", bouquetCaption: "Here's your bouquet before it leaves our studio",
    recipient: "For", recipientH: "Who it's for", buyerH: "Who's buying", buyerHint: "Gets the notices and the email when it goes out. Add at least a phone or an email.",
    buyerNamePh: "Who placed the order", cardMsg: "Card message", cardPh: "What goes on the card", notifyBuyer: "Notify the buyer",
    bouquetPhoto: "Bouquet photo", bouquetHint: "Photo of the finished bouquet. The customer sees it on their link.", readyTitle: "Ready · #{num}", confirmReady: "Mark ready",
    searchPh: "Search no., name or phone", searchTitle: "Search: “{q}”", searchNone: "No orders match",
    st_prep: "Preparing", st_ready: "Ready", st_transit: "On the way", st_done: "Delivered", st_fail: "Nobody home",
    grpLate: "Overdue", grpNext: "Next few days", tomorrow: "Tomorrow", myRoute: "Today's route", myOrders: "My orders",
    todayCount: "{n} for today", nothingToday: "Nothing for today", allClear: "All caught up",
    actReady: "Mark ready", actOut: "Heading out", actDelivered: "Delivered", actMissed: "Nobody home", call: "Call", map: "Map",
    outMailed: "On the way. The customer gets an email.", outNoMail: "On the way (the order has no customer email)",
    deliverTitle: "Deliver #{num}", noteOpt: "Note for the customer (optional)", deliveredNotePh: "E.g. Left it with the guard",
    confirmDelivered: "Confirm delivery", deliveredOk: "Delivered",
    missedTitle: "Nobody home · #{num}", missedHint: "Take a photo of the door and pick when to come back. The order goes back to Ready for that day and the customer sees it on their link.",
    newDate: "New date", newSlot: "New time", missedNotePh: "Leave it empty and we write one with the time and the new date",
    confirmMissed: "Reschedule", rescheduled: "Rescheduled for {date}",
    needPhone: "Add the customer's phone first", autoMailHint: "With an email, the customer gets an automatic email when the order goes out.", moreDetails: "More details",
    signIn: "Sign in", signInTitle: "Sign in to Orders", email: "Email", password: "Password", enter: "Sign in", logout: "Sign out",
    badLogin: "Wrong email or password.", tabOrders: "Orders", tabTeam: "Team",
    noAccess: "No access", noAccessTxt: "The account {email} isn't on the Casa de Flores team. Ask an admin to add you.",
    subAdmin: "Admin · {name}", subVendor: "Florist · {name}", subModerator: "Moderator · {name}", subCarrier: "Driver · {name}",
    role_admin: "Admin", role_moderator: "Moderator", role_vendor: "Florist", role_carrier: "Driver", phoneShort: "Phone",
    emptyCarrier: "Orders ready to deliver today will show up here.",
    prevMonth: "Previous month", nextMonth: "Next month", today: "Today", newOrder: "+ New order",
    flowHint: "Preparing → Ready → On the way → Delivered. The customer gets an automatic email when it goes out.",
    purge: "Delete delivered ({n})", purgeAsk: "Delete {n} delivered orders and their photos? Their tracking links will stop working.",
    yesDelete: "Yes, delete", cancel: "Cancel", purgeFail: "Couldn't delete them", purged: "{n} orders deleted",
    dow: ["M", "T", "W", "T", "F", "S", "S"], nOrders: "{n} orders", oneOrder: "1 order",
    noOrdersDay: "No orders this day", emptyAdmin: "Press “+ New order” to add one from the customer's screenshot.",
    emptyVendor: "You have no orders for today or the next few days.",
    noPhotoShort: "no photo", noAddress: "No address", unassigned: "Unassigned", loadFail: "Couldn't load the orders",
    statusFail: "Couldn't change the status",
    close: "Close", order: "Order #{num}", loadingPhoto: "Loading photo…", noPhoto: "No photo", photoFail: "Couldn't load the photo",
    photoAlt: "Reference photo", dateSlot: "Date and time slot", customer: "Customer", noName: "No name", address: "Address",
    channel: "Channel", noChannel: "No channel", note: "Note / instructions", noNotes: "No notes", photo: "Reference photo (what to make)", status: "Status",
    namePh: "Who receives the flowers", addrPh: "Street, number, flat, city", notesPh: "Card message, phone, instructions…",
    pasteHint: "Optional: the model, colours or inspiration photo the customer asked for. Only the team sees it. Paste it with Ctrl+V / ⌘V, drop it here or", changePhoto: "Change photo", uploadPhoto: "Upload photo", remove: "Remove",
    notImage: "That file isn't an image. Use a photo or a screenshot.", converting: "Converting iPhone photo…",
    readFail: "Couldn't read that image. Try taking a screenshot of it and pasting that.",
    linkAfterSave: "The customer link appears once the order is saved.", copied: "Link copied", selectCopy: "Select it and copy it",
    copy: "Copy", view: "Open", save: "Save", askDelete: "Delete order #{num}? This can't be undone.", deleteFail: "Couldn't delete it",
    deleted: "Order deleted", dupNum: "Order #{num} already exists. Use another number.", saveFail: "Couldn't save: {msg}",
    photoUploadFail: "Order saved, but the photo couldn't be uploaded", created: "Order created", saved: "Order saved",
    newOrderTitle: "New order", editOrder: "Edit order #{num}", date: "Date", slot: "Delivery time", orderNum: "Order no.",
    customerName: "Name", deliveryAddr: "Delivery address", vendor: "Florist",
    customerLink: "Customer link", delete: "Delete", openMaps: "Open in Google Maps ↗",
    addPerson: "Add person", name: "Name", role: "Role", roleVendor: "Seller", initialPass: "Initial password", passPh: "At least 8 characters",
    addHint: "Give them the email and this password. If they already had an account in this project, they keep theirs.", add: "Add",
    team: "Team", teamSub: "Florist: sees their orders for today, tomorrow and the week. Driver: sees today's deliveries. Admin: everything.", you: "You", confirmRemove: "Remove? Confirm",
    removeFail: "Couldn't remove them", removed: "{name} no longer has access", addFail: "Couldn't add them",
    addedExisting: "{name} added (they already had an account, use their password)", added: "{name} added",
    trackSub: "Your order tracking", loadingOrder: "Loading your order…", notFound: "We couldn't find this order",
    notFoundTxt: "Check that the link is complete, or message us on the channel where you placed your order.",
    autoRefresh: "This page updates by itself when the status changes.", updated: "Updated {when}",
    pending: "Pending", noneFiltered: "Nothing matches this filter", showAll: "Show all", lightMode: "Light mode", darkMode: "Dark mode", bigText: "Larger text",
    deliveryNote: "Note for the customer", deliveryNotePh: "E.g. Nobody was home, we'll come back tomorrow 12-16", deliveryNoteHint: "The customer sees it on their tracking link.",
    proofPhoto: "Proof photo", proofHint: "Photo of the door or the delivered bouquet", phone: "Phone", emailOpt: "Email (optional)",
    notify: "Notify the customer", deliverySection: "Delivery: note and proof photo",
    msgPrep: "Hi{name}, we're preparing your Casa de Flores order #{num}. Track it here: {link}",
    msgReady: "Hi{name}, your Casa de Flores order #{num} is ready. Track it here: {link}",
    msgTransit: "Hi{name}, your Casa de Flores order #{num} is on its way. Track it here: {link}",
    msgDone: "Hi{name}, your Casa de Flores order #{num} has been delivered. Thank you! {link}",
    msgFail: "Hi{name}, we tried to deliver your Casa de Flores order #{num} but nobody was home. Details: {link}",
    mailSubject: "Your order #{num} · Casa de Flores", needEmail: "Add the customer's email first", copyMsg: "Copy message", msgLang: "Message language", sending: "Sending…", mailSent: "Email sent to {to}", mailFail: "Couldn't send the email: {msg}", saveFirst: "Save the order before sending the email",
    history: "Notification history", histEmpty: "No notices sent for this order yet.", histVendor: "Florist", histCustomer: "Customer", histSent: "sent", histFailed: "failed", histOpened: "opened", histNoText: "(no text saved)", histAuto: "Automatic",
    slotCustom: "Custom time…", slotFrom: "From", slotTo: "To", slotInvalid: "Pick the time slot: the end must be after the start.", msgCopied: "Message copied",
    settings: "Settings", language: "Language", textSize: "Text size", normal: "Normal", large: "Large", theme: "Mode", light: "Light", dark: "Dark", auto: "Auto",
    failedTitle: "We couldn't deliver it", failedTxt: "We came to the address and nobody was home. We'll contact you to try again.",
    stepTxt: ["We're preparing your bouquet", "Your bouquet is ready to go", "Your bouquet is on its way", "Delivered. Thank you for your order!"],
  },
};

Object.assign(I18N.es,{"skipContent":"Ir a los pedidos","studioTitle":"Cada entrega merece cuidado.","studioIntro":"Del taller a su puerta. Todos los pedidos, en tus manos.","manilaTime":"Horarios de entrega · Manila (PHT)","loginHelp":"Acceso para el equipo de Casa de Flores.","chooseDate":"Cambiar fecha","searchAll":"Buscar pedidos en todas las fechas","searchPh":"Nº de pedido, nombre, teléfono o dirección…","clearSearch":"Limpiar búsqueda","searchResults":"Resultados en todas las fechas","routeTitle":"Tu ruta del día","summaryTotal":"Pedidos","summaryPending":"Pendientes","summaryFailed":"Intentos fallidos","summaryUnassigned":"Sin asignar","offline":"Sin conexión. Los datos visibles pueden estar desactualizados. Reconéctate antes de guardar.","loadError":"No se pudieron actualizar los pedidos. Revisa la conexión y vuelve a intentarlo.","retry":"Reintentar","loading":"Cargando pedidos…","map":"Mapa","call":"Llamar","details":"Ver detalles","readOnly":"Consulta de pedidos asignados","states":["Preparando","Listo","En reparto","Entregado","Intento fallido"],"duplicate":"Duplicar","duplicateHint":"Revisa fecha, dirección y captura antes de guardar la copia.","customSlot":"Personalizada","startTime":"Desde","endTime":"Hasta","invalidSlot":"La hora final debe ser posterior a la inicial.","savedDefaults":"Se recuerda la última franja y canal usados.","trackingError":"No podemos actualizar tu pedido","trackingErrorTxt":"Comprueba tu conexión e inténtalo de nuevo. Tu enlace sigue siendo válido.","shopNote":"Una nota de Casa de Flores","careTitle":"Un poco de cuidado, más días de flores","careText":"Recorta los tallos, cambia el agua cada dos días y evita el sol directo.","contactShop":"¿Necesitas ayuda?","contactHint":"Escríbenos por Messenger, Viber o el canal donde hiciste tu compra. Incluye el número de pedido.","deliveryWindow":"Entrega prevista","proofUnavailable":"No se pudo cargar la foto de prueba.","manila":"Hora de Manila (PHT)","privacyHint":"Este enlace es privado. Compártelo solo con quien deba ver tu pedido.","statusUpdated":"Estado actualizado","emptySearch":"No hay pedidos que coincidan","draftWarning":"Hay cambios sin guardar. ¿Cerrar y descartarlos?","partialSave":"Pedido guardado con una incidencia en las fotos. Abre el pedido para comprobarlas.","purgeHint":"El borrado elimina el historial y desactiva los enlaces. Revisa los entregados antes de confirmar.","quickFilters":"Filtros rápidos","allOrders":"Todos los pedidos","summaryPrep":"Preparando","statToday":"En la fecha seleccionada","statPending":"Por completar","statPrep":"En el taller","statFailed":"Requieren atención","statUnassigned":"Necesitan asignación","timelineView":"Cronología","compactView":"Compacta","viewMode":"Vista de pedidos","allStatuses":"Todos los estados","maintenance":"Gestionar entregados","stepTxt":["Nuestros floristas están preparando tus flores","Frescas y listas para salir","Tus flores van de camino","Flores entregadas. Gracias por compartir flores."],"failedTitle":"Intento de entrega"});
Object.assign(I18N.en,{"skipContent":"Skip to orders","studioTitle":"Every delivery deserves care.","studioIntro":"From our studio to their doorstep. Keep every order in hand.","manilaTime":"Delivery times · Manila (PHT)","loginHelp":"For the Casa de Flores team.","chooseDate":"Choose date","searchAll":"Search orders across all dates","searchPh":"Order number, name, phone or address…","clearSearch":"Clear search","searchResults":"Results across all dates","routeTitle":"Your route for the day","summaryTotal":"Orders","summaryPending":"Pending","summaryFailed":"Delivery attempts","summaryUnassigned":"Unassigned","offline":"You are offline. Visible information may be out of date. Reconnect before saving.","loadError":"Orders could not be refreshed. Check your connection and try again.","retry":"Try again","loading":"Loading orders…","map":"Map","call":"Call","details":"View details","readOnly":"Your assigned orders · read only","states":["Preparing","Ready","In transit","Delivered","Delivery attempted"],"duplicate":"Duplicate","duplicateHint":"Check the date, address and screenshot before saving this copy.","customSlot":"Custom","startTime":"From","endTime":"Until","invalidSlot":"End time must be later than start time.","savedDefaults":"Your last time slot and channel are remembered.","trackingError":"We cannot update your order","trackingErrorTxt":"Check your connection and try again. Your tracking link is still valid.","shopNote":"A note from Casa de Flores","careTitle":"A little care, a few more days of flowers","careText":"Trim the stems, change the water every two days and keep your flowers away from direct sun.","contactShop":"Need a hand?","contactHint":"Message us on Messenger, Viber or the channel where you placed your order. Include your order number.","deliveryWindow":"Expected delivery","proofUnavailable":"The proof photo could not be loaded.","manila":"Manila time (PHT)","privacyHint":"This is a private link. Share it only with people who should see your order.","statusUpdated":"Status updated","emptySearch":"No matching orders","draftWarning":"You have unsaved changes. Close and discard them?","partialSave":"Order saved with a photo issue. Reopen the order to check the images.","purgeHint":"Deleting removes the history and disables tracking links. Review delivered orders before confirming.","quickFilters":"Quick filters","allOrders":"All orders","summaryPrep":"In preparation","statToday":"On the selected date","statPending":"Waiting to be completed","statPrep":"Being prepared","statFailed":"Needs attention","statUnassigned":"Needs assignment","timelineView":"Timeline","compactView":"Compact","viewMode":"Order view","allStatuses":"All statuses","maintenance":"Manage delivered orders","stepTxt":["Our florists are arranging your flowers","Fresh and ready to go","Your flowers are on their way","Delivered. Thank you for sharing flowers."],"failedTitle":"Delivery attempted"});
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
  const root = document.documentElement, th = pref("cdf-theme") || "dark", sz = pref("cdf-size") || "";
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
