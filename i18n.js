// Viewer preferences (language, light/dark, text size, animations) and the Spanish / English texts.
// Static HTML uses data-i18n (text), data-i18n-ph (placeholder) and data-i18n-aria (aria-label).
// Messages that go to customers are always taken from the English set (tIn("en", …)).
const I18N = {
  es: {
    // panel (rediseño)
    statusH: "Estado", channelH: "Canal", allStatuses: "Todos los estados", accountMenu: "Cuenta y ajustes", expandNav: "Desplegar barra lateral", collapseNav: "Plegar barra lateral",
    openNav: "Abrir navegación", closeNav: "Cerrar navegación", sections: "Secciones", settings: "Ajustes",
    changePassword: "Cambiar contraseña", newPass: "Nueva contraseña", repeatPass: "Repite la contraseña", passMin: "La contraseña debe tener al menos 8 caracteres.",
    passMismatch: "Las contraseñas no coinciden.", passChanged: "Contraseña cambiada. Úsala la próxima vez que entres.", savePassword: "Guardar contraseña", accountOf: "Cuenta: {email}",
    sendFeedback: "Enviar sugerencia", fbType: "Tipo", fbIdea: "Idea", fbBug: "Algo no funciona", fbOther: "Otro", fbMsg: "Mensaje", fbPh: "Cuéntanos qué mejorarías o qué no funciona…",
    fbTo: "Llega directamente a {to}.", fbOpened: "Se ha abierto tu correo con el mensaje listo. Solo falta pulsar Enviar.", fbEmpty: "Escribe tu mensaje.", send: "Enviar",
    pricesAdmin: "Precios (solo admin)", pricesOff: "Desactivados", pricesOn: "Activados", amount: "Importe (₱)", amountHint: "Opcional. Sirve para las estadísticas de ventas.",
    flowHint: "En preparación → Listo → En reparto → Entregado. El cliente recibe un correo automático cuando sale.",
    chanWarn: "No has marcado el canal (Shopify, Instagram, TikTok o Web). Puedes guardar igualmente.", savedNoChannel: "Guardado sin canal. Puedes añadirlo después desde el pedido.",
    repeatOne: "Cliente recurrente · 1 pedido anterior", repeatMany: "Cliente recurrente · {n} pedidos anteriores", repeatSum: " · {sum} en total",
    sumPrep: "por preparar", sumReady: "listos", sumTransit: "en reparto", sumDone: "entregados", sumFail: "intentos fallidos", reschedule: "Reprogramar",
    phoneCc: "Teléfono (+63)", kpiSales: "Ventas", bySales: "Ventas por canal",
    appTitle: "Pedidos · Casa de Flores", trackTitle: "Tu pedido · Casa de Flores", skipContent: "Ir a los pedidos", sections: "Secciones",
    signIn: "Inicia sesión", signInTitle: "Entrar en Pedidos", loginHelp: "Acceso para el equipo de Casa de Flores.", email: "Email", password: "Contraseña", enter: "Entrar", logout: "Salir",
    studioTitle: "Cada entrega merece cuidado.", studioIntro: "Del taller a su puerta. Todos los pedidos, en tus manos.", manilaTime: "Horarios de entrega · Manila (PHT)",
    badLogin: "Email o contraseña incorrectos.", noAccess: "Sin acceso", noAccessTxt: "La cuenta {email} no está en el equipo de Casa de Flores. Pide a un admin que te añada.",
    tabOrders: "Pedidos", tabTeam: "Equipo", tabStats: "Estadísticas",
    subAdmin: "Admin · {name}", subVendor: "Florista · {name}", subModerator: "Moderador · {name}", subCarrier: "Repartidor · {name}",
    role_admin: "Admin", role_moderator: "Moderador", role_vendor: "Florista", role_carrier: "Repartidor",
    settings: "Ajustes", language: "Idioma", textSize: "Tamaño de letra", normal: "Normal", large: "Grande", theme: "Modo", light: "Claro", dark: "Oscuro", auto: "Auto",
    motion: "Animaciones", motionFull: "Completas", motionReduced: "Reducidas",
    offline: "Sin conexión. Lo que ves puede no estar al día; reconéctate antes de guardar.", loadError: "No se pudieron actualizar los pedidos.", retry: "Reintentar", loading: "Cargando…",
    loadFail: "No se pudieron cargar los pedidos",
    // calendar and day
    chooseDate: "Cambiar fecha", prevMonth: "Mes anterior", nextMonth: "Mes siguiente", today: "Hoy", tomorrow: "Mañana", newOrder: "Nuevo pedido",
    dow: ["L", "M", "X", "J", "V", "S", "D"], nOrders: "{n} pedidos", oneOrder: "1 pedido", manila: "Hora de Manila",
    quickFilters: "Filtros", allOrders: "Todos", searchAll: "Buscar en todas las fechas", searchPh: "Buscar en todas las fechas — pedido, nombre o teléfono", clearSearch: "Limpiar búsqueda",
    searchResults: "Resultados", searchTitle: "Búsqueda: «{q}»", emptySearch: "No hay pedidos que coincidan",
    summaryTotal: "Pedidos", summaryPending: "Pendientes", summaryPrep: "En el taller", summaryFailed: "No había nadie", summaryUnassigned: "Sin florista", summaryRisk: "En riesgo",
    timelineView: "Cronología", compactView: "Compacta", viewMode: "Vista de pedidos", select: "Seleccionar", bulkActions: "Acciones con la selección",
    noOrdersDay: "Sin pedidos este día", emptyAdmin: "Pulsa «Nuevo pedido» (o la tecla N) para añadir uno desde la captura del cliente.",
    noneFiltered: "Nada con este filtro", showAll: "Ver todos",
    missedBanner: "No había nadie: {n} reprogramado(s) desde este día", retryTag: "Intento {n} · no había nadie el {date}", retryTagNoDate: "Intento {n} · antes no había nadie",
    riskBanner: "{n} pedido(s) necesitan atención", seeAll: "Ver todos", risk_late: "Atrasado", risk_shouldBeOut: "Ya debería haber salido", risk_noFlorist: "Sin florista y sale pronto",
    details: "Ver detalles", notify: "Avisar al cliente", selectOrder: "Seleccionar el pedido #{num}", nSelected: "{n} seleccionados", selectAll: "Todos los visibles",
    assignFlorist: "Asignar florista", bulkDone: "{n} pedidos actualizados", done: "Hecho", assignedTo: "Florista: {name}", undo: "Deshacer",
    // steps
    st_prep: "En preparación", st_ready: "Listo", st_transit: "En reparto", st_done: "Entregado", st_fail: "Intento fallido",
    db_Preparing: "Preparando", db_Ready: "Listo", db_: "—", db_Intransit: "En camino", db_Delivered: "Entregado", db_Failed: "No había nadie",
    actReady: "Marcar listo", actOut: "Salir a repartir", actOutAgain: "Volver a salir", actDelivered: "Entregado", actMissed: "No había nadie", call: "Llamar", map: "Mapa",
    status: "Estado", delivery: "Entrega", statusFail: "No se pudo cambiar el estado",
    confirmTransit: "¿Marcar el pedido #{num} en camino?", markTransit: "Sí, en camino", transitMailTo: "Se enviará un correo automático a {to} con el enlace de seguimiento.", transitNoMail: "El pedido no tiene email: no se enviará ningún correo.",
    confirmBack: "¿Volver el pedido #{num} a «{step}»?", moveBack: "Sí, volver", confirmBackHint: "El cliente verá ese estado en su enlace.",
    outNoMail: "En camino (el pedido no tiene email del cliente)", outSending: "En camino. Enviando el correo a {to}…", mailSent: "Correo enviado a {to}", mailFail: "No se pudo enviar el correo: {msg}", mailUnknown: "En camino. El correo aún no consta como enviado; revisa el historial de avisos.",
    readyTitle: "Listo · #{num}", confirmReady: "Marcar listo", deliverTitle: "Entregar #{num}", noteOpt: "Nota para el cliente (opcional)", deliveredNotePh: "Ej.: Se lo dejé al portero",
    confirmDelivered: "Confirmar entrega", deliveredOk: "Entregado",
    missedTitle: "No había nadie · #{num}", missedHint: "Haz una foto de la puerta y elige cuándo volver. El pedido vuelve a «Listo» para ese día y el cliente lo ve en su enlace.",
    newDate: "Nueva fecha", newSlot: "Nueva hora", missedNotePh: "Si lo dejas vacío escribimos uno en inglés con la hora y la nueva fecha", confirmMissed: "Reprogramar", rescheduled: "Reprogramado para {date}",
    // florist and driver
    grpLate: "Atrasados", grpNext: "Próximos días", myRoute: "Mi ruta de hoy", myOrders: "Mis pedidos", todayCount: "{n} para hoy", nothingToday: "Nada para hoy", allClear: "Todo al día",
    emptyVendor: "No tienes pedidos para hoy ni para los próximos días.", emptyCarrier: "Cuando haya pedidos listos para repartir aparecerán aquí.",
    // order sheet
    close: "Cerrar", cancel: "Cancelar", save: "Guardar", order: "Pedido #{num}", newOrderTitle: "Nuevo pedido", editOrder: "Pedido #{num}", duplicateTitle: "Copia de pedido",
    date: "Fecha", slot: "Hora de entrega", slotFrom: "Desde", slotTo: "Hasta", slotInvalid: "Elige la hora: «hasta» tiene que ser después de «desde».",
    orderNum: "Nº pedido", vendor: "Florista", carrier: "Repartidor", anyCarrier: "Cualquier repartidor", carrierHint: "Si eliges uno, solo esa persona lo ve. Si no, lo coge quien salga a repartirlo.",
    unassigned: "Sin asignar", buyerH: "Quién compra", buyerHint: "Recibe los avisos y el correo cuando sale. Pon al menos teléfono o email.", buyerNamePh: "Quien hizo el pedido",
    buyerName: "Comprador", buyerPhone: "Teléfono del comprador", name: "Nombre", phone: "Teléfono", phoneShort: "Teléfono",
    autoMailHint: "Con email, recibe un correo automático cuando el pedido sale.",
    recipientH: "Para quién", sameAsBuyer: "Es para la misma persona que compra (no es un regalo)", customerName: "Nombre", deliveryAddr: "Dirección de entrega",
    namePh: "Quién recibe las flores", addrPh: "Calle, número, piso, ciudad", openMaps: "Abrir en Google Maps ↗", cardMsg: "Mensaje de la tarjeta", cardPh: "Lo que va escrito en la tarjeta",
    photo: "Foto de referencia (qué ramo hacer)", photoAlt: "Foto de referencia", noPhoto: "Sin foto", loadingPhoto: "Cargando foto…", photoFail: "No se pudo cargar la foto",
    pasteHint: "Opcional: el modelo, colores o foto de inspiración. Solo la ve el equipo. Pégala con Ctrl+V / ⌘V, arrástrala aquí o", changePhoto: "Cambiar foto", uploadPhoto: "Subir foto", remove: "Quitar",
    notImage: "Ese archivo no es una imagen. Usa una foto o una captura de pantalla.", converting: "Convirtiendo foto de iPhone…", readFail: "No se pudo leer esa imagen. Prueba a hacerle una captura de pantalla y pegarla.",
    photoUploadFail: "La foto no se pudo subir", partialSave: "Pedido guardado, pero alguna foto no se pudo subir. Ábrelo para comprobarlas.",
    moreDetails: "Más detalles", channel: "Canal", noChannel: "Sin canal", note: "Nota interna", notesPh: "Instrucciones para el equipo…", noNotes: "Sin notas",
    bouquetPhoto: "Foto del ramo", bouquetHint: "Foto del ramo terminado. El cliente la ve en su enlace.",
    deliveryNote: "Nota para el cliente", deliveryNotePh: "Ej.: Volvemos mañana de 12 a 16", deliveryNoteHint: "El cliente la ve en su enlace de seguimiento.",
    proofPhoto: "Foto de prueba", proofHint: "Foto de la puerta o del ramo entregado",
    customerLink: "Enlace para el cliente", linkAfterSave: "El enlace para el cliente aparece al guardar el pedido.", copy: "Copiar", view: "Abrir", copied: "Enlace copiado", selectCopy: "Selecciónalo y cópialo",
    fillRequired: "Rellena los campos marcados con *.", phoneInvalid: "Revisa el teléfono marcado: no parece un número de Filipinas, de España ni con prefijo internacional.", emailInvalid: "Ese email no parece válido.",
    dupNum: "Ya existe un pedido #{num}. Usa otro número.", saveFail: "No se pudo guardar: {msg}", created: "Pedido creado", saved: "Pedido guardado",
    goneMeanwhile: "Este pedido ya no existe: lo han borrado mientras lo editabas.",
    conflictAsk: "Otra persona ha cambiado este pedido mientras lo editabas. ¿Guardar tus cambios encima?", conflictKeepMine: "Guardar los míos",
    changedMeanwhile: "Este pedido acaba de cambiar en otro dispositivo. Al guardar solo se envía lo que tú has tocado.",
    draftWarning: "Hay cambios sin guardar. ¿Cerrar y descartarlos?", discard: "Descartar",
    draftFound: "Tienes un pedido nuevo sin guardar. ¿Recuperarlo?", draftRestore: "Recuperar", draftRestored: "Borrador recuperado. Revísalo y guarda.",
    duplicate: "Duplicar", duplicateHint: "Copia de otro pedido: revisa la fecha, la hora y la dirección antes de guardar.",
    archive: "Archivar", restore: "Restaurar", archived: "Archivado", archivedN: "{n} pedido(s) archivado(s)", restoredN: "{n} pedido(s) restaurado(s)",
    delete: "Borrar", askDelete: "¿Borrar el pedido #{num} para siempre? No se puede deshacer.", deleteHintArchive: "Si solo quieres quitarlo de la vista, mejor archívalo: conserva el historial y el enlace.",
    yesDelete: "Sí, borrar", deleteFail: "No se pudo borrar", deleted: "Pedido borrado",
    notifyBuyer: "Avisar a quien compra", needPhone: "Añade el teléfono del cliente primero", copyMsg: "Copiar mensaje", msgCopied: "Mensaje copiado", copyShort: "Copiado",
    history: "Historial de avisos", histEmpty: "Aún no se ha enviado ningún aviso de este pedido.", histVendor: "Florista", histCustomer: "Cliente", histSent: "enviado", histFailed: "falló", histOpened: "abierto", histNoText: "(sin texto guardado)", histAuto: "Automático",
    changeLog: "Historial de cambios", evEmpty: "Sin cambios registrados todavía.", evSystem: "Sistema", evPhotoYes: "con foto", evPhotoNo: "sin foto",
    ev_created: "Creado", ev_updated: "Editado", ev_status: "Cambio de estado", ev_rescheduled: "Reprogramado", ev_archived: "Archivado", ev_restored: "Restaurado",
    recipient: "Para", address: "Dirección", noAddress: "Sin dirección", noName: "Sin nombre", dateSlot: "Fecha y franja",
    // sidebar tools
    archiveDelivered: "Archivar entregados ({n})", archiveAsk: "¿Archivar {n} pedidos entregados?", archiveHint: "Salen de la vista diaria, pero conservan su historial, sus fotos y el enlace del cliente. Puedes restaurarlos.",
    seeArchived: "Ver archivados del mes", archivedTitle: "Archivados · {month}",
    purge: "Borrar entregados ({n})", purgeAsk: "¿Borrar {n} pedidos entregados y sus fotos? Sus enlaces de seguimiento dejarán de funcionar.", purgeFail: "No se pudieron borrar", purged: "{n} pedidos borrados",
    exportCsv: "Exportar CSV", exportTitle: "Exportar pedidos", from: "Desde", to: "Hasta", includeArchived: "Incluir archivados", exportHint: "Se descarga un archivo CSV que abre Excel, Numbers o Google Sheets.",
    download: "Descargar", rangeInvalid: "Revisa las fechas: «hasta» no puede ser antes que «desde».", exported: "{n} pedidos exportados", attempts: "Intentos",
    // team
    addPerson: "Añadir persona", role: "Rol", roleHint: "Florista: sus pedidos. Repartidor: las entregas. Moderador: todos los pedidos, sin equipo ni borrado. Admin: todo.",
    initialPass: "Contraseña inicial", passPh: "Mínimo 8 caracteres", addHint: "Pásale el email y esta contraseña. Si ya tenía cuenta en este proyecto, conserva la suya.", add: "Añadir",
    team: "Equipo", teamSub: "Los floristas solo ven los pedidos que tienen asignados.", you: "Tú", openLoad: "{n} pedidos abiertos",
    removeAsk: "¿Quitar a {name} del equipo?", removeHint: "Pierde el acceso al momento. Sus pedidos se quedan sin asignar.", removeFail: "No se pudo quitar", removed: "{name} ya no tiene acceso",
    addFail: "No se pudo añadir", addedExisting: "{name} añadido (ya tenía cuenta, usa su contraseña)", added: "{name} añadido",
    // statistics
    statsSub: "Cómo han ido los últimos días, archivados incluidos.", period: "Periodo", noData: "Sin datos en este periodo.",
    kpiOrders: "Pedidos", kpiPerDay: "{n} al día", kpiDelivered: "Entregados", kpiFirstTry: "Entregados a la primera", kpiFirstTryHint: "Sin «no había nadie»",
    kpiAttempts: "Visitas fallidas", kpiAttemptsHint: "Veces que no había nadie", kpiOpenLate: "Atrasados sin entregar", kpiOpenLateHint: "De días ya pasados",
    kpiRepeat: "Clientes que repiten", kpiRepeatHint: "Compraron más de una vez en el periodo",
    perDay: "Pedidos por día", byChannel: "Por canal", byFlorist: "Por florista", bySlot: "Por franja", morning: "Mañana (antes de 12)", afternoon: "Tarde (12–17)", evening: "Noche (desde 17)",
    // tracking page
    trackSub: "Seguimiento de tu pedido", loadingOrder: "Cargando tu pedido…", notFound: "No encontramos este pedido",
    notFoundTxt: "Revisa que el enlace esté completo o escríbenos por el mismo canal donde hiciste tu compra.",
    autoRefresh: "Esta página se actualiza sola cuando cambia el estado.", updated: "Actualizado {when}",
    loadErrTitle: "No se pudo cargar tu pedido", loadErrTxt: "Parece un problema de conexión. Inténtalo de nuevo en un momento.", staleNote: "sin conexión, puede no estar al día",
    forName: "Para: {name}", bouquetCaption: "Tu ramo antes de salir de nuestro taller", failedTitle: "Intento de entrega",
    failedTxt: "Hemos pasado por la dirección y no había nadie. Te contactaremos para volver a intentarlo.",
    stepTxt: ["Nuestros floristas están preparando tus flores", "Frescas y listas para salir", "Tus flores van de camino", "Flores entregadas. Gracias por compartir flores."],
    // messages opened in WhatsApp from the panel (customers get the English set)
    msgPrep: "Hola{name}, estamos preparando tu pedido #{num} de Casa de Flores. Síguelo aquí: {link}",
    msgReady: "Hola{name}, tu pedido #{num} de Casa de Flores está listo. Síguelo aquí: {link}",
    msgTransit: "Hola{name}, tu pedido #{num} de Casa de Flores va de camino. Síguelo aquí: {link}",
    msgDone: "Hola{name}, tu pedido #{num} de Casa de Flores se ha entregado. ¡Gracias! {link}",
    msgFail: "Hola{name}, hemos intentado entregar tu pedido #{num} de Casa de Flores pero no había nadie. Más información: {link}",
  },
  en: {
    // panel (redesign)
    statusH: "Status", channelH: "Channel", allStatuses: "All statuses", accountMenu: "Account and settings", expandNav: "Expand sidebar", collapseNav: "Collapse sidebar",
    openNav: "Open navigation", closeNav: "Close navigation", sections: "Sections", settings: "Settings",
    changePassword: "Change password", newPass: "New password", repeatPass: "Repeat the password", passMin: "The password needs at least 8 characters.",
    passMismatch: "The passwords don't match.", passChanged: "Password changed. Use it next time you sign in.", savePassword: "Save password", accountOf: "Account: {email}",
    sendFeedback: "Send a suggestion", fbType: "Type", fbIdea: "Idea", fbBug: "Something's broken", fbOther: "Other", fbMsg: "Message", fbPh: "Tell us what you'd improve or what isn't working…",
    fbTo: "Goes straight to {to}.", fbOpened: "Your email app opened with the message ready. Just press Send.", fbEmpty: "Write your message.", send: "Send",
    pricesAdmin: "Prices (admin only)", pricesOff: "Off", pricesOn: "On", amount: "Amount (₱)", amountHint: "Optional. Used for the sales statistics.",
    flowHint: "Preparing → Ready → Out for delivery → Delivered. The customer gets an automatic email when it goes out.",
    chanWarn: "You haven't marked the channel (Shopify, Instagram, TikTok or Web). You can save anyway.", savedNoChannel: "Saved without a channel. You can add it later from the order.",
    repeatOne: "Returning customer · 1 earlier order", repeatMany: "Returning customer · {n} earlier orders", repeatSum: " · {sum} in total",
    sumPrep: "to prepare", sumReady: "ready", sumTransit: "out for delivery", sumDone: "delivered", sumFail: "failed attempts", reschedule: "Reschedule",
    phoneCc: "Phone (+63)", kpiSales: "Sales", bySales: "Sales by channel",
    appTitle: "Orders · Casa de Flores", trackTitle: "Your order · Casa de Flores", skipContent: "Skip to orders", sections: "Sections",
    signIn: "Sign in", signInTitle: "Sign in to Orders", loginHelp: "For the Casa de Flores team.", email: "Email", password: "Password", enter: "Sign in", logout: "Sign out",
    studioTitle: "Every delivery deserves care.", studioIntro: "From our studio to their doorstep. Keep every order in hand.", manilaTime: "Delivery times · Manila (PHT)",
    badLogin: "Wrong email or password.", noAccess: "No access", noAccessTxt: "The account {email} isn't on the Casa de Flores team. Ask an admin to add you.",
    tabOrders: "Orders", tabTeam: "Team", tabStats: "Statistics",
    subAdmin: "Admin · {name}", subVendor: "Florist · {name}", subModerator: "Moderator · {name}", subCarrier: "Driver · {name}",
    role_admin: "Admin", role_moderator: "Moderator", role_vendor: "Florist", role_carrier: "Driver",
    settings: "Settings", language: "Language", textSize: "Text size", normal: "Normal", large: "Large", theme: "Mode", light: "Light", dark: "Dark", auto: "Auto",
    motion: "Animations", motionFull: "Full", motionReduced: "Reduced",
    offline: "You're offline. What you see may be out of date; reconnect before saving.", loadError: "Orders could not be refreshed.", retry: "Try again", loading: "Loading…",
    loadFail: "Couldn't load the orders",
    chooseDate: "Choose date", prevMonth: "Previous month", nextMonth: "Next month", today: "Today", tomorrow: "Tomorrow", newOrder: "New order",
    dow: ["M", "T", "W", "T", "F", "S", "S"], nOrders: "{n} orders", oneOrder: "1 order", manila: "Manila time",
    quickFilters: "Filters", allOrders: "All", searchAll: "Search all dates", searchPh: "Search all dates — order, name or phone", clearSearch: "Clear search",
    searchResults: "Results", searchTitle: "Search: “{q}”", emptySearch: "No matching orders",
    summaryTotal: "Orders", summaryPending: "Pending", summaryPrep: "In the studio", summaryFailed: "Nobody home", summaryUnassigned: "No florist", summaryRisk: "At risk",
    timelineView: "Timeline", compactView: "Compact", viewMode: "Order view", select: "Select", bulkActions: "Actions on the selection",
    noOrdersDay: "No orders this day", emptyAdmin: "Press “New order” (or the N key) to add one from the customer's screenshot.",
    noneFiltered: "Nothing matches this filter", showAll: "Show all",
    missedBanner: "Nobody home: {n} rescheduled from this day", retryTag: "Attempt {n} · nobody home on {date}", retryTagNoDate: "Attempt {n} · nobody home before",
    riskBanner: "{n} order(s) need attention", seeAll: "See all", risk_late: "Overdue", risk_shouldBeOut: "Should be out by now", risk_noFlorist: "No florist, leaves soon",
    details: "Details", notify: "Notify the customer", selectOrder: "Select order #{num}", nSelected: "{n} selected", selectAll: "All visible",
    assignFlorist: "Assign florist", bulkDone: "{n} orders updated", done: "Done", assignedTo: "Florist: {name}", undo: "Undo",
    st_prep: "Preparing", st_ready: "Ready", st_transit: "On the way", st_done: "Delivered", st_fail: "Nobody home",
    db_Preparing: "Preparing", db_Ready: "Ready", db_: "—", db_Intransit: "On the way", db_Delivered: "Delivered", db_Failed: "Nobody home",
    actReady: "Mark ready", actOut: "Head out", actOutAgain: "Head out again", actDelivered: "Delivered", actMissed: "Nobody home", call: "Call", map: "Map",
    status: "Status", delivery: "Delivery", statusFail: "Couldn't change the status",
    confirmTransit: "Mark order #{num} as on the way?", markTransit: "Yes, on the way", transitMailTo: "An automatic email with the tracking link goes to {to}.", transitNoMail: "The order has no email: no email will be sent.",
    confirmBack: "Move order #{num} back to “{step}”?", moveBack: "Yes, move back", confirmBackHint: "The customer will see that status on their link.",
    outNoMail: "On the way (the order has no customer email)", outSending: "On the way. Sending the email to {to}…", mailSent: "Email sent to {to}", mailFail: "Couldn't send the email: {msg}", mailUnknown: "On the way. The email isn't logged as sent yet; check the notification history.",
    readyTitle: "Ready · #{num}", confirmReady: "Mark ready", deliverTitle: "Deliver #{num}", noteOpt: "Note for the customer (optional)", deliveredNotePh: "E.g. Left it with the guard",
    confirmDelivered: "Confirm delivery", deliveredOk: "Delivered",
    missedTitle: "Nobody home · #{num}", missedHint: "Take a photo of the door and pick when to come back. The order goes back to Ready for that day and the customer sees it on their link.",
    newDate: "New date", newSlot: "New time", missedNotePh: "Leave it empty and we write one with the time and the new date", confirmMissed: "Reschedule", rescheduled: "Rescheduled for {date}",
    grpLate: "Overdue", grpNext: "Next few days", myRoute: "Today's route", myOrders: "My orders", todayCount: "{n} for today", nothingToday: "Nothing for today", allClear: "All caught up",
    emptyVendor: "You have no orders for today or the next few days.", emptyCarrier: "Orders ready to deliver will show up here.",
    close: "Close", cancel: "Cancel", save: "Save", order: "Order #{num}", newOrderTitle: "New order", editOrder: "Order #{num}", duplicateTitle: "Copy of an order",
    date: "Date", slot: "Delivery time", slotFrom: "From", slotTo: "To", slotInvalid: "Pick the time slot: the end must be after the start.",
    orderNum: "Order no.", vendor: "Florist", carrier: "Driver", anyCarrier: "Any driver", carrierHint: "Pick one and only they see it. Otherwise whoever heads out with it takes it.",
    unassigned: "Unassigned", buyerH: "Who's buying", buyerHint: "Gets the notices and the email when it goes out. Add at least a phone or an email.", buyerNamePh: "Who placed the order",
    buyerName: "Buyer", buyerPhone: "Buyer's phone", name: "Name", phone: "Phone", phoneShort: "Phone",
    autoMailHint: "With an email, they get an automatic email when the order goes out.",
    recipientH: "Who it's for", sameAsBuyer: "It's for the buyer themselves (not a gift)", customerName: "Name", deliveryAddr: "Delivery address",
    namePh: "Who receives the flowers", addrPh: "Street, number, flat, city", openMaps: "Open in Google Maps ↗", cardMsg: "Card message", cardPh: "What goes on the card",
    photo: "Reference photo (what to make)", photoAlt: "Reference photo", noPhoto: "No photo", loadingPhoto: "Loading photo…", photoFail: "Couldn't load the photo",
    pasteHint: "Optional: the model, colours or inspiration photo. Only the team sees it. Paste it with Ctrl+V / ⌘V, drop it here or", changePhoto: "Change photo", uploadPhoto: "Upload photo", remove: "Remove",
    notImage: "That file isn't an image. Use a photo or a screenshot.", converting: "Converting iPhone photo…", readFail: "Couldn't read that image. Try taking a screenshot of it and pasting that.",
    photoUploadFail: "The photo couldn't be uploaded", partialSave: "Order saved, but a photo couldn't be uploaded. Open it to check the pictures.",
    moreDetails: "More details", channel: "Channel", noChannel: "No channel", note: "Internal note", notesPh: "Instructions for the team…", noNotes: "No notes",
    bouquetPhoto: "Bouquet photo", bouquetHint: "Photo of the finished bouquet. The customer sees it on their link.",
    deliveryNote: "Note for the customer", deliveryNotePh: "E.g. We'll come back tomorrow 12-16", deliveryNoteHint: "The customer sees it on their tracking link.",
    proofPhoto: "Proof photo", proofHint: "Photo of the door or the delivered bouquet",
    customerLink: "Customer link", linkAfterSave: "The customer link appears once the order is saved.", copy: "Copy", view: "Open", copied: "Link copied", selectCopy: "Select it and copy it",
    fillRequired: "Fill in the fields marked with *.", phoneInvalid: "Check the marked phone: it doesn't look like a Philippine, Spanish or international number.", emailInvalid: "That email doesn't look right.",
    dupNum: "Order #{num} already exists. Use another number.", saveFail: "Couldn't save: {msg}", created: "Order created", saved: "Order saved",
    goneMeanwhile: "This order no longer exists: it was deleted while you were editing.",
    conflictAsk: "Someone else changed this order while you were editing. Save your changes over theirs?", conflictKeepMine: "Save mine",
    changedMeanwhile: "This order just changed on another device. Saving only sends what you touched.",
    draftWarning: "You have unsaved changes. Close and discard them?", discard: "Discard",
    draftFound: "You have an unsaved new order. Bring it back?", draftRestore: "Bring it back", draftRestored: "Draft restored. Check it and save.",
    duplicate: "Duplicate", duplicateHint: "Copied from another order: check the date, time and address before saving.",
    archive: "Archive", restore: "Restore", archived: "Archived", archivedN: "{n} order(s) archived", restoredN: "{n} order(s) restored",
    delete: "Delete", askDelete: "Delete order #{num} for good? This can't be undone.", deleteHintArchive: "To just take it off the view, archive it instead: it keeps the history and the link.",
    yesDelete: "Yes, delete", deleteFail: "Couldn't delete it", deleted: "Order deleted",
    notifyBuyer: "Notify the buyer", needPhone: "Add the customer's phone first", copyMsg: "Copy message", msgCopied: "Message copied", copyShort: "Copied",
    history: "Notification history", histEmpty: "No notices sent for this order yet.", histVendor: "Florist", histCustomer: "Customer", histSent: "sent", histFailed: "failed", histOpened: "opened", histNoText: "(no text saved)", histAuto: "Automatic",
    changeLog: "Change history", evEmpty: "No changes recorded yet.", evSystem: "System", evPhotoYes: "with photo", evPhotoNo: "no photo",
    ev_created: "Created", ev_updated: "Edited", ev_status: "Status change", ev_rescheduled: "Rescheduled", ev_archived: "Archived", ev_restored: "Restored",
    recipient: "For", address: "Address", noAddress: "No address", noName: "No name", dateSlot: "Date and time slot",
    archiveDelivered: "Archive delivered ({n})", archiveAsk: "Archive {n} delivered orders?", archiveHint: "They leave the daily view but keep their history, photos and customer link. You can restore them.",
    seeArchived: "Archived this month", archivedTitle: "Archived · {month}",
    purge: "Delete delivered ({n})", purgeAsk: "Delete {n} delivered orders and their photos? Their tracking links will stop working.", purgeFail: "Couldn't delete them", purged: "{n} orders deleted",
    exportCsv: "Export CSV", exportTitle: "Export orders", from: "From", to: "To", includeArchived: "Include archived", exportHint: "Downloads a CSV file that opens in Excel, Numbers or Google Sheets.",
    download: "Download", rangeInvalid: "Check the dates: “to” can't be before “from”.", exported: "{n} orders exported", attempts: "Attempts",
    addPerson: "Add person", role: "Role", roleHint: "Florist: their own orders. Driver: deliveries. Moderator: every order, no team or deleting. Admin: everything.",
    initialPass: "Initial password", passPh: "At least 8 characters", addHint: "Give them the email and this password. If they already had an account in this project, they keep theirs.", add: "Add",
    team: "Team", teamSub: "Florists only see the orders assigned to them.", you: "You", openLoad: "{n} open orders",
    removeAsk: "Remove {name} from the team?", removeHint: "They lose access at once. Their orders become unassigned.", removeFail: "Couldn't remove them", removed: "{name} no longer has access",
    addFail: "Couldn't add them", addedExisting: "{name} added (they already had an account, use their password)", added: "{name} added",
    statsSub: "How the last days went, archived orders included.", period: "Period", noData: "No data in this period.",
    kpiOrders: "Orders", kpiPerDay: "{n} a day", kpiDelivered: "Delivered", kpiFirstTry: "Delivered first time", kpiFirstTryHint: "No “nobody home”",
    kpiAttempts: "Failed visits", kpiAttemptsHint: "Times nobody was home", kpiOpenLate: "Overdue, not delivered", kpiOpenLateHint: "From days already past",
    kpiRepeat: "Returning customers", kpiRepeatHint: "Ordered more than once in the period",
    perDay: "Orders per day", byChannel: "By channel", byFlorist: "By florist", bySlot: "By time of day", morning: "Morning (before 12)", afternoon: "Afternoon (12–17)", evening: "Evening (from 17)",
    trackSub: "Your order tracking", loadingOrder: "Loading your order…", notFound: "We couldn't find this order",
    notFoundTxt: "Check that the link is complete, or message us on the channel where you placed your order.",
    autoRefresh: "This page updates by itself when the status changes.", updated: "Updated {when}",
    loadErrTitle: "We couldn't load your order", loadErrTxt: "This looks like a connection problem. Please try again in a moment.", staleNote: "offline, may be out of date",
    forName: "For: {name}", bouquetCaption: "Here's your bouquet before it leaves our studio", failedTitle: "Delivery attempted",
    failedTxt: "We came to the address and nobody was home. We'll contact you to try again.",
    stepTxt: ["Our florists are arranging your flowers", "Fresh and ready to go", "Your flowers are on their way", "Delivered. Thank you for sharing flowers."],
    msgPrep: "Hi{name}, we're preparing your Casa de Flores order #{num}. Track it here: {link}",
    msgReady: "Hi{name}, your Casa de Flores order #{num} is ready. Track it here: {link}",
    msgTransit: "Hi{name}, your Casa de Flores order #{num} is on its way. Track it here: {link}",
    msgDone: "Hi{name}, your Casa de Flores order #{num} has been delivered. Thank you! {link}",
    msgFail: "Hi{name}, we tried to deliver your Casa de Flores order #{num} but nobody was home. Details: {link}",
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

// ---------- light / dark, text size and animations ----------
// Animations are always on unless the person turns them down here (the operating system setting is not used).
const pref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const savePref = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
function applyPrefs() {
  const root = document.documentElement, th = pref("cdf-theme") || "dark", sz = pref("cdf-size") || "", mo = pref("cdf-motion") === "reduced" ? "reduced" : "full";
  if (th === "auto") delete root.dataset.theme; else root.dataset.theme = th;
  if (sz === "lg") root.dataset.size = "lg"; else delete root.dataset.size;
  root.dataset.motion = mo;
  for (const b of document.querySelectorAll("button[data-size]")) b.setAttribute("aria-pressed", String(b.dataset.size === sz));
  for (const b of document.querySelectorAll("[data-theme-set]")) b.setAttribute("aria-pressed", String(b.dataset.themeSet === th));
  for (const b of document.querySelectorAll("[data-motion-set]")) b.setAttribute("aria-pressed", String(b.dataset.motionSet === mo));
  for (const b of document.querySelectorAll("[data-prices]")) b.setAttribute("aria-pressed", String(b.dataset.prices === (pref("cdf-prices") || "")));
  for (const s of document.querySelectorAll(".seg")) placePill(s);
}
// Segmented controls: a pill slides under the pressed button
function placePill(box) {
  let pill = box.querySelector(":scope > .pill");
  if (!pill) {
    pill = document.createElement("span"); pill.className = "pill"; pill.setAttribute("aria-hidden", "true"); box.prepend(pill);
    if (window.ResizeObserver) new ResizeObserver(() => placePill(box)).observe(box);
  }
  const a = box.querySelector('button[aria-pressed="true"]');
  pill.style.opacity = a ? "1" : "0";
  if (a) { pill.style.width = a.offsetWidth + "px"; pill.style.transform = `translateX(${a.offsetLeft}px)`; }
}
// Menus (settings, account): opened with a class so they animate in and out
const openMenu = () => document.querySelector(".settings .menu.open");
function setMenu(menu, open) {
  menu.classList.toggle("open", open);
  menu.parentElement.querySelector("[data-settings]")?.setAttribute("aria-expanded", String(open));
  if (open) for (const s of menu.querySelectorAll(".seg")) placePill(s);
}
document.addEventListener("click", (e) => {
  const gear = e.target.closest("[data-settings]");
  const cur = openMenu();
  if (gear) { const m = gear.parentElement.querySelector(".menu"); if (cur && cur !== m) setMenu(cur, false); setMenu(m, !m.classList.contains("open")); return; }
  if (cur && (!e.target.closest(".settings") || e.target.closest(".mitem"))) setMenu(cur, false);
  const l = e.target.closest(".lang button"); if (l) { setLang(l.dataset.lang); applyPrefs(); return; }
  const z = e.target.closest("button[data-size]"); if (z) { savePref("cdf-size", z.dataset.size); applyPrefs(); return; }
  const th = e.target.closest("button[data-theme-set]"); if (th) { savePref("cdf-theme", th.dataset.themeSet); applyPrefs(); return; }
  const mo = e.target.closest("button[data-motion-set]"); if (mo) { savePref("cdf-motion", mo.dataset.motionSet === "reduced" ? "reduced" : ""); applyPrefs(); return; }
  const pr = e.target.closest("button[data-prices]"); if (pr) { savePref("cdf-prices", pr.dataset.prices); applyPrefs(); document.dispatchEvent(new Event("priceschange")); }
});
document.addEventListener("keydown", (e) => {
  const m = openMenu();
  if (e.key === "Escape" && m) { setMenu(m, false); m.parentElement.querySelector("[data-settings]")?.focus(); }
});
applyStatic();
applyPrefs();
