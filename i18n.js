// Viewer preferences (language, light/dark, text size, animations) and the Spanish / English texts.
// Static HTML uses data-i18n (text), data-i18n-ph (placeholder) and data-i18n-aria (aria-label).
// Messages that go to customers are always taken from the English set (tIn("en", …)).
const I18N = {
  es: {
    dropPoint: "Ubicación exacta (para Lalamove)", dropPh: "Enlace de Google Maps del cliente", dropHint: "Opcional. Pulsa «Buscar la dirección en el mapa» y elige la buena, o pega el enlace de Maps si el cliente te lo manda.", dropFind: "Buscar la dirección en el mapa",
    dropOk: "Punto guardado · comprobar en el mapa ↗", dropBad: "No reconozco esa ubicación. Pega un enlace de Google Maps (en Filipinas) o «lat, lng».", dropResolving: "Abriendo el enlace…",
    llManualOut: "Lo lleva otra persona: marcar «En camino» sin Lalamove", llShopMissingMine: "Tu tienda aún no tiene dirección de recogida. Pídesela al admin.",
    llSandboxNoMove: "Modo pruebas: este envío no es real y el pedido no avanzará solo.",
    notifPushServiceErr: "Este navegador no consigue activar las notificaciones (su servicio de avisos no responde). En Brave: Ajustes → Privacidad → activa «Usar servicios de Google para mensajes push». Si no, prueba con Chrome o con la app instalada en el móvil.",
    llFrom: "Recoge en {name}: {address}", llNoFlorist: "Asigna primero una florista y guarda el pedido: el rider recoge en su tienda.",
    llShopMissing: "{name} aún no tiene dirección de recogida. Añádela en Equipo → editar.",
    pickupTitle: "Recogida Lalamove (su tienda)", pickupAddr: "Dirección de la tienda", pickupAddrPh: "Calle, número, barrio, Quezon City",
    pickupPoint: "Ubicación exacta", pickupPointPh: "Enlace de Google Maps o 14.65, 121.04", pickupPointHint: "Pega el enlace de Google Maps de la tienda. El teléfono de recogida es el de su perfil.",
    pickupPointBad: "No reconozco esa ubicación. Pega un enlace de Google Maps (en Filipinas) o «lat, lng».", pickupBoth: "Pon la dirección y la ubicación, o deja las dos vacías.",
    pickupNoPhone: "Esta florista no tiene teléfono en su perfil: Lalamove lo necesita para la recogida.",
    periodDay: "Día", period7: "7 días", period30: "30 días", periodDates: "Fechas", noOrdersPeriod: "No hay pedidos en estas fechas",
    bouquetPrice: "Precio del ramo", bouquetPriceHint: "En pesos filipinos (PHP). Solo lo ve el admin.",
    extraPhotos: "Fotos", extraPhotosHint: "Puedes añadir varias. Las ve también la florista del pedido.", addPhotos: "Añadir fotos",
    driversOff: "Las cuentas de repartidor están desactivadas por ahora. Si necesitas entrar, habla con el admin.",
    trackingOffTitle: "Seguimiento no disponible", trackingOff: "El seguimiento de pedidos no está disponible por ahora. Si tienes cualquier duda, contacta con Casa de Flores.",
    llSandbox: "Pruebas (sandbox)", llLive: "Real", llNotSetUp: "Lalamove aún no está configurado: faltan las claves o la dirección de la tienda.",
    llIntro: "Pide un rider de Lalamove para este pedido.", llStart: "Enviar con Lalamove", llWhereHint: "Busca la dirección de entrega o pega un enlace de Google Maps. Lalamove necesita el punto exacto.",
    llSearchPh: "Dirección o enlace de Google Maps", llSearch: "Buscar", llNoHits: "No la encuentro. Prueba con menos detalle o pega un enlace de Google Maps.",
    llDeliverTo: "Entrega en:", llCheckPin: "Comprobar el punto en el mapa ↗", llVehicle: "Vehículo", llPickup: "Recogida", llNow: "Ahora", llInSlot: "Para llegar en la franja {slot}",
    llv_MOTORCYCLE: "Moto", llv_SEDAN: "Coche", llv_MPV: "Monovolumen",
    vehicleHint: "Moto para ramos normales; coche para arreglos grandes o varias piezas.",
    statsRiders: "Riders Lalamove", statsRidersHint: "Lo pagado a Lalamove por los pedidos del periodo", statsRidersTest: "Modo prueba: precios de sandbox, no se ha cobrado nada",
    statsRidersTrips: "{n} viajes", statsRidersAvg: "media {sum}", statsRidersShare: "{n}% de las ventas",
    gapBanner: "{n} pedido(s) de hoy o mañana sin poder pedir rider todavía", gapNoFlorist: "sin florista asignada", gapNoShop: "{name} no tiene la dirección de su tienda (Equipo → Editar)",
    gapAsk: "A este pedido le falta algo para pedir el rider", saveAnyway: "Guardar igualmente",
    gapFlorist: "sin florista (no se sabe de qué tienda sale)", gapRecipientPhone: "sin teléfono de quien recibe (el rider llamará al comprador)",
    llGetPrice: "Ver precio", llChangePlace: "Cambiar dirección", llValidUntil: "precio válido hasta {time}",
    llNotReady: "El pedido aún no está listo. Reserva cuando el ramo esté preparado o programa la recogida.", llNeedPhone: "Falta un teléfono válido de quien recibe: el rider lo necesita.",
    llBook: "Reservar rider", llBookAsk: "¿Reservar un rider por {fee}?", llBookSandbox: "Modo pruebas: no se cobra nada y no vendrá ningún rider.", llBookLive: "Se cobrará de la wallet de Lalamove.",
    llBooked: "Rider pedido", llFinding: "Buscando rider…", llTrack: "Seguimiento en Lalamove ↗", llRefresh: "Actualizar",
    llCancel: "Cancelar envío", llCancelAsk: "¿Cancelar el envío de Lalamove?", llCancelled: "Envío cancelado", llAgain: "Pedir otro rider",
    llOrderCancelled: "El pedido está cancelado.",
    ll_ASSIGNING_DRIVER: "Buscando rider", ll_ON_GOING: "Rider en camino a la tienda", ll_PICKED_UP: "Recogido, en camino", ll_COMPLETED: "Entregado",
    ll_CANCELED: "Cancelado", ll_REJECTED: "Rechazado", ll_EXPIRED: "Caducado",
    viewProfile: "Ver perfil", profileStatsUnavailable: "Estadísticas no disponibles", openOrders: "Abiertos",
    expandPhoto: "Ampliar foto de referencia",
    chatOrderTitle: "Conversación interna", chatOrderPrivacy: "Solo visible para el equipo con acceso a este pedido.",
    chatEdit: "Editar mensaje", chatEdited: "Editado", chatEditFail: "No se pudo guardar el cambio. Si editaste el mensaje en otro dispositivo, vuelve a abrirlo.",
    loginIdentity: "Usuario o correo", username: "Usuario", usernameHint: "Opcional. De 3 a 30 letras sin acentos, números, puntos, guiones o guiones bajos.", usernameTaken: "Ese usuario ya está en uso. Elige otro.",
    statsTicket: "Ticket medio",
    statsAverage: "Media por día",
    statsLeading: "Canal principal",
    statsDelta: "{n}% frente a los {days} días anteriores",
    statsPeriodHint: "Últimos {days} días",
    statsAll: "Todo",
    statsCustom: "Rango",
    statsFrom: "Desde",
    statsTo: "Hasta",
    statsAvail: "Datos disponibles: del {from} al {to} · {n} pedidos",
    statsAvailNone: "Todavía no hay pedidos registrados.",
    statsRangeHint: "Del {from} al {to} · {days} días",
    salesPerMonth: "Ventas por mes",
    ordersPerMonth: "Pedidos por mes",
    salesPerWeek: "Ventas por semana",
    salesPerDay: "Ventas por día",
    ordersPerWeek: "Pedidos por semana",
    statsHours: "Horas más pedidas",
    statsHoursHint: "Hora de inicio de la franja · Manila",
    statsCustomers: "Mejores clientes",
    statsHistoryHint: "Historial completo hasta hoy, archivados incluidos",
    statsIdeas: "Ideas para crecer",
    statsIdeasHint: "Calculadas con tus datos",
    statsTotal: "Total",
    statsLast: "Último pedido",
    statsFirstHint: "Entregados sin reintento / entregados o intentados",
    statsRepeatHint: "Clientes del periodo con más de un pedido histórico",
    ideaLeading: "{channel} aporta el {n}% del total.",
    ideaLeadingHelp: "Publica ahí primero las novedades y los ramos de temporada.",
    ideaWeak: "{channel}: {n} pedidos en el periodo.",
    ideaWeakHelp: "Revisa si una promoción o un enlace directo ayudaría a ese canal.",
    ideaPremium: "{channel} tiene el mayor ticket medio: {sum}.",
    ideaPremiumHelp: "Prueba ramos premium o complementos en ese canal.",
    ideaAttempts: "El {n}% de las entregas intentadas no se completa a la primera.",
    ideaAttemptsHelp: "Confirma la disponibilidad del destinatario antes de salir.",
    ideaHour: "La franja de las {hour} es la más pedida.",
    ideaHourHelp: "Planifica preparación y reparto para esa hora.",
    ideaRepeat: "El {n}% de los clientes del periodo ya ha comprado más de una vez.",
    ideaRepeatHelp: "Un pequeño detalle en el siguiente pedido ayuda a fidelizar.",
    priceLoadFail: "No se pudieron cargar los importes. Vuelve a intentarlo.",
    priceSaveFail: "El pedido está guardado, pero el importe no. Reintenta guardar para completarlo.",
    repeatUnavailable: "No se pudo comprobar el historial del cliente.",
    searchFailed: "No se pudo completar la búsqueda. Vuelve a intentarlo.",
    searchLimit: "Se muestran 200 resultados. Especifica más la búsqueda.",
    // panel (rediseño)
    statusH: "Estado", channelH: "Canal", allStatuses: "Todos los estados", accountMenu: "Cuenta y ajustes", expandNav: "Desplegar barra lateral", collapseNav: "Plegar barra lateral",
    openNav: "Abrir navegación", closeNav: "Cerrar navegación", sections: "Secciones", settings: "Ajustes",
    changePassword: "Cambiar contraseña", newPass: "Nueva contraseña", repeatPass: "Repite la contraseña", passMin: "La contraseña debe tener al menos 8 caracteres.",
    passMismatch: "Las contraseñas no coinciden.", passChanged: "Contraseña cambiada. Úsala la próxima vez que entres.", savePassword: "Guardar contraseña", accountOf: "Cuenta: {email}",
    updateReady: "Hay una versión nueva de la app. Se actualizará en unos segundos.", updateNow: "Actualizar ahora",
    installApp: "Instalar la app", installTitle: "Instalar la app", installIosTitle: "Instalar en el iPhone", gotIt: "Entendido",
    installIos1: "En Safari, pulsa el botón Compartir (el cuadrado con la flecha hacia arriba).", installIos2: "Elige «Añadir a pantalla de inicio» y pulsa «Añadir».",
    installIos3: "Abre «Casa de Flores» desde el icono nuevo y activa las notificaciones en Preferencias.", installAndroid1: "Abre el menú del navegador (⋮ arriba a la derecha).",
    installAndroid2: "Elige «Instalar aplicación» o «Añadir a pantalla de inicio».", installDone: "App instalada. Ábrela desde tu pantalla de inicio.",
    notifications: "Notificaciones", notifTurnOn: "Activar", notifTurnOff: "Desactivar", notifHelp: "Cómo activarlas",
    notifIsOn: "Activadas en este dispositivo", notifIsOff: "Menciones y pedidos asignados", notifNeedInstall: "En iPhone, primero instala la app",
    notifIsDenied: "Bloqueadas en este navegador",
    notifAskTitle: "Activa las notificaciones en este dispositivo", notifAskTxt: "Así te llegan las menciones y los pedidos que te asignan aunque tengas la app cerrada.",
    notifAskInstallTitle: "Instala la app para recibir avisos", notifAskInstallTxt: "En iPhone los avisos solo llegan si abres la app desde su icono, sin la barra de Safari. Si ya tenías un icono de antes, bórralo y vuelve a añadirla.", notifLater: "Ahora no", notifUnsupported: "Este navegador no las admite",
    notifOnToast: "Notificaciones activadas en este dispositivo.", notifOffToast: "Notificaciones desactivadas en este dispositivo.",
    notifDenied: "No se activaron: se rechazó el permiso.", notifFail: "No se pudieron activar las notificaciones. Inténtalo de nuevo.",
    notifDeniedHelp: "Están bloqueadas. Permítelas para este sitio en los ajustes del navegador o del teléfono y vuelve a intentarlo.",
    chatSearch: "Buscar conversación", chatFilter: "Mostrar", chatAll: "Todas", chatUnreadOnly: "Sin leer", chatAllRead: "Todo leído 🎉", chatNoResults: "Sin resultados",
    chatDirect: "Mensaje privado", chatDirectNew: "Nuevo mensaje privado", chatDirectFail: "No se pudo abrir la conversación privada.",
    chatNew: "Nuevos", chatJump: "Mensajes nuevos", chatTyping: "{name} está escribiendo…", chatTypingMany: "Varias personas están escribiendo…",
    chatEmoji: "Emojis", chatEmojiSearch: "Buscar emoji (flor, ok, camión…)", chatReact: "Reaccionar", chatMoreReact: "Más reacciones", chatCopy: "Copiar texto", chatCopied: "Texto copiado",
    chatPeople: "{n} personas", chatEmptyHint: "Usa @ para mencionar a alguien y # para enlazar un pedido.",
    emo_recent: "Recientes", emo_flowers: "Flores", emo_work: "Entregas", emo_faces: "Caras", emo_hands: "Gestos", emo_hearts: "Corazones", emo_party: "Celebración",
    tabChat: "Conversaciones", chatSub: "El canal de todo el equipo.", chatTeam: "equipo", chatTeamDesc: "Avisos para todo el equipo",
    chatTitle: "Conversación", chatPh: "Escribe un mensaje… @ para mencionar a alguien, # para un pedido", chatNoOrder: "No se encontró el pedido #{num} o no tienes acceso.", chatSend: "Enviar", chatEmpty: "Aún no hay mensajes. Escribe el primero.",
    chatOpenOrder: "Abrir pedido", chatMentioned: "{name} te ha mencionado en {where}", chatSee: "Ver", chatYesterday: "Ayer", chatYou: "Tú", chatBack: "Volver a conversaciones",
    chatCount: "{n} mensajes", chatUnread: "{n} sin leer", chatPick: "Elige una conversación de la lista.", chatFail: "No se pudo enviar. Inténtalo de nuevo.",
    linkExpired: "Ese enlace ya se usó o ha caducado. Pide otro con «¿Olvidaste tu contraseña?».", linkFailed: "No se pudo abrir el enlace. Pide otro con «¿Olvidaste tu contraseña?».",
    forgotPass: "¿Olvidaste tu contraseña?", forgotTitle: "Recuperar el acceso", forgotHelp: "Escribe el correo de tu cuenta (no el usuario). Te enviaremos un enlace para poner una contraseña nueva.",
    forgotSend: "Enviar enlace", forgotBadEmail: "Escribe un correo válido.", forgotFail: "No se pudo enviar el enlace. Inténtalo de nuevo en un momento.",
    forgotLimit: "Se han pedido demasiados enlaces. Espera unos minutos y vuelve a intentarlo.", forgotSent: "Si {email} tiene una cuenta, le llegará un enlace en unos minutos. Revisa también el spam.",
    resetTitle: "Pon tu contraseña nueva", resetHelp: "Cuenta: {email}. Elige una contraseña de al menos 8 caracteres.",
    sendFeedback: "Enviar sugerencia", fbType: "Tipo", fbIdea: "Idea", fbBug: "Algo no funciona", fbOther: "Otro", fbMsg: "Mensaje", fbPh: "Cuéntanos qué mejorarías o qué no funciona…",
    fbTo: "Llega directamente a {to}.", fbOpened: "Se ha abierto tu correo con el mensaje listo. Solo falta pulsar Enviar.", fbEmpty: "Escribe tu mensaje.", send: "Enviar",
    pricesAdmin: "Precios (solo admin)", showPrices: "Mostrar precios", preferences: "Preferencias", goHome: "Ir a Pedidos", myAccount: "Mi cuenta", back: "Volver", pricesOff: "Desactivados", pricesOn: "Activados", amount: "Importe (₱)", amountHint: "Opcional. Sirve para las estadísticas de ventas.",
    flowHint: "En preparación → Listo → En reparto → Entregado. El cliente recibe un correo automático cuando sale.",
    chanWarn: "No has marcado el canal (Shopify, Instagram, TikTok o Web). Puedes guardar igualmente.", savedNoChannel: "Guardado sin canal. Puedes añadirlo después desde el pedido.",
    repeatOne: "Cliente recurrente · 1 pedido anterior", repeatMany: "Cliente recurrente · {n} pedidos anteriores", repeatSum: " · {sum} en total",
    sumPrep: "por preparar", sumReady: "listos", sumTransit: "en reparto", sumDone: "entregados", sumFail: "intentos fallidos", reschedule: "Reprogramar",
    phoneCc: "Teléfono (+63)", edit: "Editar", editMember: "Editar persona", memberSaved: "Guardado: {name}", editFail: "No se ha podido guardar", ownRoleHint: "Tu propio rol no se puede cambiar desde aquí.", countryCode: "Prefijo del país", otherCode: "Otro (escribe +…)", searchCountry: "Buscar país o prefijo", noCountry: "No se encontraron países",
    availability: "Disponibilidad", available: "Disponible", unavailable: "No disponible", awayFrom: "Ausente desde el {from}", awayUntil: "Ausente hasta el {until}", awayOpen: "Ausente hasta nuevo aviso",
    reason_vacation: "Vacaciones", reason_rest: "Descanso", reason_other: "Otro", reasonNone: "Sin indicar", reasonLabel: "Motivo (opcional)",
    awayFromLabel: "Desde", awayUntilLabel: "Hasta (opcional)", backNextDay: "«Hasta» es el último día de ausencia: vuelve al día siguiente. Sin fecha, sigue ausente hasta que lo cambies. Fechas en hora de Filipinas.",
    visibleToTeam: "Lo ve el equipo al asignar pedidos", endBeforeStart: "La fecha de vuelta no puede ser anterior a la de inicio.", noEndDate: "Sin fecha de vuelta",
    assignAwayAsk: "{name} no está disponible ese día", assignAnyway: "Asignar igualmente", assignAwayDetail: "Ausencia en: {dates} (hasta {until}).",
    awayConflicts: "Pedidos pendientes asignados durante una ausencia: {n}", myAwayOrders: "Tienes {n} pedido(s) pendiente(s) en esas fechas. Avisa a la oficina para que los reasigne.",
    editProfile: "Editar perfil", personalData: "Datos personales", displayName: "Nombre visible", emailIsLogin: "Puedes entrar con tu correo o con tu usuario. El correo no se cambia desde aquí.", usernamePh: "p. ej. maria.flores",
    saveChanges: "Guardar cambios", profileSaved: "Perfil guardado", doneOrders: "{n} pedidos entregados", myShop: "Mi floristería", online: "Conectado", doneSince: "Pedidos entregados que preparaste o entregaste tú.", kpiSales: "Ventas", bySales: "Ventas por canal",
    appTitle: "Pedidos · Casa de Flores", trackTitle: "Tu pedido · Casa de Flores", skipContent: "Ir a los pedidos", sections: "Secciones",
    signIn: "Inicia sesión", signInTitle: "Entrar en Pedidos", loginHelp: "Acceso para el equipo de Casa de Flores.", email: "Email", password: "Contraseña", enter: "Entrar", logout: "Salir",
    studioTitle: "Cada entrega merece cuidado.", studioIntro: "Del taller a su puerta. Todos los pedidos, en tus manos.", manilaTime: "Horarios de entrega · Manila (PHT)",
    badLogin: "Usuario, correo o contraseña incorrectos.", noAccess: "Sin acceso", noAccessTxt: "La cuenta {email} no está en el equipo de Casa de Flores. Pide a un admin que te añada.",
    tabOrders: "Pedidos", tabTeam: "Equipo", tabStats: "Estadísticas",
    subAdmin: "Admin · {name}", subVendor: "Florista · {name}", subCarrier: "Repartidor · {name}",
    role_admin: "Admin", role_vendor: "Florista", role_carrier: "Repartidor",
    branch: "Sucursal", branchPh: "Ej.: Parañaque", branchOf: "Casa de Flores · {b}",
    settings: "Ajustes", language: "Idioma", textSize: "Tamaño de letra", normal: "Normal", large: "Grande", theme: "Modo", light: "Claro", dark: "Oscuro", auto: "Auto",
    motion: "Animaciones", motionFull: "Completas", motionReduced: "Reducidas", sounds: "Sonidos", soundOn: "Activados", soundOff: "Desactivados",
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
    deliveryNote: "Indicaciones de entrega", deliveryNotePh: "Ej.: Torre B, piso 12, unidad 1205. Dejar en recepción.", deliveryNoteHint: "Piso, torre, recepción… Se envían al rider de Lalamove junto con la dirección.",
    riderNoteOpt: "Indicaciones para el próximo intento (opcional)", riderNotePh: "Ej.: Llamar al llegar, el cliente estará en recepción",
    proofPhoto: "Foto de prueba", proofHint: "Foto de la puerta o del ramo entregado",
    customerLink: "Enlace para el cliente", linkAfterSave: "El enlace para el cliente aparece al guardar el pedido.", copy: "Copiar", view: "Abrir", copied: "Enlace copiado", selectCopy: "Selecciónalo y cópialo",
    fillRequired: "Rellena los campos marcados con *.", phoneInvalid: "Revisa el teléfono marcado: no parece un número de Filipinas, de España ni con prefijo internacional.", emailInvalid: "Ese email no parece válido.",
    dupNum: "Ya existe un pedido #{num}. Usa otro número.", saveFail: "No se pudo guardar: {msg}", created: "Pedido creado", saved: "Pedido guardado",
    goneMeanwhile: "Este pedido ya no existe: lo han borrado mientras lo editabas.",
    busyRetry: "El pedido está cambiando ahora mismo. Vuelve a guardar en un momento.",
    st_cancel: "Cancelado", sumCancel: "cancelados", cancelledTag: "Cancelado", cancelledCol: "cancelado (motivo)", cancelReasonShort: "Motivo:",
    cancelOrder: "Cancelar pedido", cancelTitle: "Cancelar el pedido #{num}", cancelReason: "Motivo", cancelReasonPh: "Por qué se cancela (lo verá el equipo, no el cliente)",
    cancelR1: "El cliente lo ha cancelado", cancelR2: "Pago no recibido", cancelR3: "Pedido duplicado", cancelNeedReason: "Escribe un motivo.",
    cancelHint: "La florista y el repartidor asignados recibirán un aviso. En el enlace de seguimiento el cliente verá el pedido como cancelado, sin el motivo. Puedes restaurarlo en cualquier momento.",
    cancelledN: "Pedido #{num} cancelado", reinstate: "Restaurar", reinstatedN: "Pedido #{num} restaurado", isCancelled: "Este pedido está cancelado. Restáuralo para moverlo.",
    cancelledBanner: "Pedido cancelado", cancelledWork: "Cancelado: no lo prepares ni lo repartas.", ev_cancelled: "Cancelado", ev_reinstated: "Restaurado tras cancelar",
    msgCancel: "Hola{name}, tu pedido #{num} de Casa de Flores ha sido cancelado. Si tienes cualquier duda, responde a este mensaje. {link}",
    cancelledTrackTitle: "Este pedido se ha cancelado", cancelledTrackTxt: "Si no esperabas esta cancelación o tienes alguna duda, escríbenos por el mismo canal donde hiciste tu compra.",
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
    addPerson: "Añadir persona", role: "Rol", roleHint: "Florista: sus pedidos. Repartidor: las entregas. Admin: todo, también el equipo.",
    initialPass: "Contraseña inicial", passPh: "Mínimo 8 caracteres", addHint: "Pásale el email y esta contraseña. Si ya tenía cuenta en este proyecto, conserva la suya.", add: "Añadir",
    team: "Equipo", teamSub: "Los floristas solo ven los pedidos que tienen asignados.", you: "Tú", openLoad: "{n} pedidos abiertos", doneTitle: "Completados", doneToday: "hoy", doneWeek: "7 días", doneMonth: "este mes", doneTotal: "en total",
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
    dropPoint: "Exact location (for Lalamove)", dropPh: "Customer's Google Maps link", dropHint: "Optional. Tap «Find the address on the map» and pick the right one, or paste the Maps link if the customer sends it.", dropFind: "Find the address on the map",
    dropOk: "Point saved · check it on the map ↗", dropBad: "Can't read that location. Paste a Google Maps link (in the Philippines) or \"lat, lng\".", dropResolving: "Opening the link…",
    llManualOut: "Someone else is taking it: mark \"On the way\" without Lalamove", llShopMissingMine: "Your shop has no pickup address yet. Ask the admin to add it.",
    llSandboxNoMove: "Test mode: this booking isn't real and the order won't move on its own.",
    notifPushServiceErr: "This browser can't turn on notifications (its push service isn't answering). In Brave: Settings → Privacy → turn on \"Use Google services for push messaging\". Otherwise try Chrome, or the app installed on your phone.",
    llFrom: "Pickup at {name}: {address}", llNoFlorist: "Assign a florist and save the order first: the rider picks up at her shop.",
    llShopMissing: "{name} has no pickup address yet. Add it in Team → edit.",
    pickupTitle: "Lalamove pickup (her shop)", pickupAddr: "Shop address", pickupAddrPh: "Street, number, barangay, Quezon City",
    pickupPoint: "Exact location", pickupPointPh: "Google Maps link or 14.65, 121.04", pickupPointHint: "Paste the shop's Google Maps link. The pickup phone is the one on her profile.",
    pickupPointBad: "Can't read that location. Paste a Google Maps link (in the Philippines) or \"lat, lng\".", pickupBoth: "Fill in both the address and the location, or leave both empty.",
    pickupNoPhone: "This florist has no phone on her profile: Lalamove needs it for the pickup.",
    periodDay: "Day", period7: "7 days", period30: "30 days", periodDates: "Dates", noOrdersPeriod: "No orders in these dates",
    bouquetPrice: "Bouquet price", bouquetPriceHint: "In Philippine pesos (PHP). Only the admin sees it.",
    extraPhotos: "Photos", extraPhotosHint: "Add as many as you need. The order's florist sees them too.", addPhotos: "Add photos",
    driversOff: "Driver accounts are switched off for now. If you need to sign in, talk to the admin.",
    trackingOffTitle: "Tracking unavailable", trackingOff: "Order tracking isn't available right now. If you have any questions, please contact Casa de Flores.",
    llSandbox: "Test (sandbox)", llLive: "Live", llNotSetUp: "Lalamove isn't set up yet: the keys or the shop address are missing.",
    llIntro: "Book a Lalamove rider for this order.", llStart: "Send with Lalamove", llWhereHint: "Search the delivery address or paste a Google Maps link. Lalamove needs the exact point.",
    llSearchPh: "Address or Google Maps link", llSearch: "Search", llNoHits: "Can't find it. Try with less detail or paste a Google Maps link.",
    llDeliverTo: "Deliver to:", llCheckPin: "Check the point on the map ↗", llVehicle: "Vehicle", llPickup: "Pickup", llNow: "Now", llInSlot: "To arrive in the {slot} slot",
    llv_MOTORCYCLE: "Motorcycle", llv_SEDAN: "Car", llv_MPV: "MPV",
    vehicleHint: "Motorcycle for regular bouquets; car for large arrangements or several pieces.",
    statsRiders: "Lalamove riders", statsRidersHint: "Paid to Lalamove for the period's orders", statsRidersTest: "Test mode: sandbox prices, nothing was charged",
    statsRidersTrips: "{n} trips", statsRidersAvg: "average {sum}", statsRidersShare: "{n}% of sales",
    gapBanner: "{n} order(s) for today or tomorrow can't get a rider yet", gapNoFlorist: "no florist assigned", gapNoShop: "{name} has no shop address (Team → Edit)",
    gapAsk: "This order is missing something for booking the rider", saveAnyway: "Save anyway",
    gapFlorist: "no florist (we don't know which shop it leaves from)", gapRecipientPhone: "no recipient phone (the rider will call the buyer)",
    llGetPrice: "Get price", llChangePlace: "Change address", llValidUntil: "price valid until {time}",
    llNotReady: "The order isn't ready yet. Book once the bouquet is done, or schedule the pickup.", llNeedPhone: "A valid recipient phone is missing: the rider needs it.",
    llBook: "Book rider", llBookAsk: "Book a rider for {fee}?", llBookSandbox: "Test mode: nothing is charged and no rider will come.", llBookLive: "It will be charged to the Lalamove wallet.",
    llBooked: "Rider requested", llFinding: "Finding a rider…", llTrack: "Track on Lalamove ↗", llRefresh: "Refresh",
    llCancel: "Cancel delivery", llCancelAsk: "Cancel the Lalamove delivery?", llCancelled: "Delivery cancelled", llAgain: "Book another rider",
    llOrderCancelled: "The order is cancelled.",
    ll_ASSIGNING_DRIVER: "Finding rider", ll_ON_GOING: "Rider heading to the shop", ll_PICKED_UP: "Picked up, on the way", ll_COMPLETED: "Delivered",
    ll_CANCELED: "Cancelled", ll_REJECTED: "Rejected", ll_EXPIRED: "Expired",
    viewProfile: "View profile", profileStatsUnavailable: "Statistics unavailable", openOrders: "Open",
    expandPhoto: "Enlarge reference photo",
    chatOrderTitle: "Internal conversation", chatOrderPrivacy: "Only visible to team members who can access this order.",
    chatEdit: "Edit message", chatEdited: "Edited", chatEditFail: "Couldn't save the change. If you edited the message on another device, reopen it.",
    loginIdentity: "Username or email", username: "Username", usernameHint: "Optional. 3–30 letters, numbers, dots, underscores or hyphens.", usernameTaken: "That username is already taken. Choose another.",
    statsTicket: "Average order value",
    statsAverage: "Average per day",
    statsLeading: "Leading channel",
    statsDelta: "{n}% versus the previous {days} days",
    statsPeriodHint: "Last {days} days",
    statsAll: "All",
    statsCustom: "Range",
    statsFrom: "From",
    statsTo: "To",
    statsAvail: "Data available: {from} to {to} · {n} orders",
    statsAvailNone: "No orders recorded yet.",
    statsRangeHint: "{from} to {to} · {days} days",
    salesPerMonth: "Sales per month",
    ordersPerMonth: "Orders per month",
    salesPerWeek: "Sales per week",
    salesPerDay: "Sales per day",
    ordersPerWeek: "Orders per week",
    statsHours: "Most requested hours",
    statsHoursHint: "Delivery window start · Manila time",
    statsCustomers: "Top customers",
    statsHistoryHint: "Full history through today, including archived orders",
    statsIdeas: "Ideas to grow",
    statsIdeasHint: "Calculated from your data",
    statsTotal: "Total",
    statsLast: "Last order",
    statsFirstHint: "Delivered without retries / delivered or attempted",
    statsRepeatHint: "Buyers in the period with more than one historical order",
    ideaLeading: "{channel} accounts for {n}% of the total.",
    ideaLeadingHelp: "Share new bouquets and seasonal collections there first.",
    ideaWeak: "{channel}: {n} orders in the period.",
    ideaWeakHelp: "Consider whether a promotion or a direct order link would help this channel.",
    ideaPremium: "{channel} has the highest average order value: {sum}.",
    ideaPremiumHelp: "Try premium bouquets or add-ons on this channel.",
    ideaAttempts: "{n}% of attempted deliveries do not succeed the first time.",
    ideaAttemptsHelp: "Confirm the recipient's availability before heading out.",
    ideaHour: "The {hour} delivery window is the most requested.",
    ideaHourHelp: "Plan preparation and delivery capacity around this hour.",
    ideaRepeat: "{n}% of buyers in the period have ordered more than once.",
    ideaRepeatHelp: "A small gesture with the next order can help bring customers back.",
    priceLoadFail: "Prices could not be loaded. Please try again.",
    priceSaveFail: "The order is saved, but its price is not. Save again to finish.",
    repeatUnavailable: "Customer history could not be checked.",
    searchFailed: "Search could not be completed. Please try again.",
    searchLimit: "Showing 200 results. Please narrow your search.",
    // panel (redesign)
    statusH: "Status", channelH: "Channel", allStatuses: "All statuses", accountMenu: "Account and settings", expandNav: "Expand sidebar", collapseNav: "Collapse sidebar",
    openNav: "Open navigation", closeNav: "Close navigation", sections: "Sections", settings: "Settings",
    changePassword: "Change password", newPass: "New password", repeatPass: "Repeat the password", passMin: "The password needs at least 8 characters.",
    passMismatch: "The passwords don't match.", passChanged: "Password changed. Use it next time you sign in.", savePassword: "Save password", accountOf: "Account: {email}",
    updateReady: "There's a new version of the app. It will refresh in a few seconds.", updateNow: "Refresh now",
    installApp: "Install the app", installTitle: "Install the app", installIosTitle: "Install on iPhone", gotIt: "Got it",
    installIos1: "In Safari, tap the Share button (the square with the arrow pointing up).", installIos2: "Choose “Add to Home Screen” and tap “Add”.",
    installIos3: "Open “Casa de Flores” from the new icon and turn notifications on in Preferences.", installAndroid1: "Open the browser menu (⋮ at the top right).",
    installAndroid2: "Choose “Install app” or “Add to Home screen”.", installDone: "App installed. Open it from your home screen.",
    notifications: "Notifications", notifTurnOn: "Turn on", notifTurnOff: "Turn off", notifHelp: "How to allow them",
    notifIsOn: "On for this device", notifIsOff: "Mentions and orders assigned to you", notifNeedInstall: "On iPhone, install the app first",
    notifIsDenied: "Blocked in this browser",
    notifAskTitle: "Turn on notifications on this device", notifAskTxt: "Get mentions and orders assigned to you even when the app is closed.",
    notifAskInstallTitle: "Install the app to get notifications", notifAskInstallTxt: "On iPhone, notifications only arrive when you open the app from its icon, without the Safari bar. If you added an icon earlier, delete it and add the app again.", notifLater: "Not now", notifUnsupported: "This browser doesn't support them",
    notifOnToast: "Notifications are on for this device.", notifOffToast: "Notifications are off for this device.",
    notifDenied: "Not turned on: permission was declined.", notifFail: "Couldn't turn notifications on. Try again.",
    notifDeniedHelp: "They're blocked. Allow them for this site in the browser or phone settings, then try again.",
    chatSearch: "Search conversations", chatFilter: "Show", chatAll: "All", chatUnreadOnly: "Unread", chatAllRead: "All caught up 🎉", chatNoResults: "No results",
    chatDirect: "Private message", chatDirectNew: "New private message", chatDirectFail: "Could not open the private conversation.",
    chatNew: "New", chatJump: "New messages", chatTyping: "{name} is typing…", chatTypingMany: "Several people are typing…",
    chatEmoji: "Emoji", chatEmojiSearch: "Search emoji (flower, ok, truck…)", chatReact: "React", chatMoreReact: "More reactions", chatCopy: "Copy text", chatCopied: "Text copied",
    chatPeople: "{n} people", chatEmptyHint: "Use @ to mention someone and # to link an order.",
    emo_recent: "Recent", emo_flowers: "Flowers", emo_work: "Deliveries", emo_faces: "Faces", emo_hands: "Gestures", emo_hearts: "Hearts", emo_party: "Celebration",
    tabChat: "Conversations", chatSub: "The whole team's channel.", chatTeam: "team", chatTeamDesc: "Notes for the whole team",
    chatTitle: "Conversation", chatPh: "Write a message… @ to mention someone, # for an order", chatNoOrder: "Order #{num} wasn't found or you don't have access.", chatSend: "Send", chatEmpty: "No messages yet. Write the first one.",
    chatOpenOrder: "Open order", chatMentioned: "{name} mentioned you in {where}", chatSee: "View", chatYesterday: "Yesterday", chatYou: "You", chatBack: "Back to conversations",
    chatCount: "{n} messages", chatUnread: "{n} unread", chatPick: "Pick a conversation from the list.", chatFail: "Couldn't send. Try again.",
    linkExpired: "That link was already used or has expired. Ask for a new one with “Forgot your password?”.", linkFailed: "The link could not be opened. Ask for a new one with “Forgot your password?”.",
    forgotPass: "Forgot your password?", forgotTitle: "Get back in", forgotHelp: "Type your account email (not the username). We'll send you a link to choose a new password.",
    forgotSend: "Send link", forgotBadEmail: "Type a valid email.", forgotFail: "The link couldn't be sent. Try again in a moment.",
    forgotLimit: "Too many links requested. Wait a few minutes and try again.", forgotSent: "If {email} has an account, a link will arrive in a few minutes. Check spam too.",
    resetTitle: "Choose a new password", resetHelp: "Account: {email}. Use at least 8 characters.",
    sendFeedback: "Send a suggestion", fbType: "Type", fbIdea: "Idea", fbBug: "Something's broken", fbOther: "Other", fbMsg: "Message", fbPh: "Tell us what you'd improve or what isn't working…",
    fbTo: "Goes straight to {to}.", fbOpened: "Your email app opened with the message ready. Just press Send.", fbEmpty: "Write your message.", send: "Send",
    pricesAdmin: "Prices (admin only)", showPrices: "Show prices", preferences: "Preferences", goHome: "Go to orders", myAccount: "My account", back: "Back", pricesOff: "Off", pricesOn: "On", amount: "Amount (₱)", amountHint: "Optional. Used for the sales statistics.",
    flowHint: "Preparing → Ready → Out for delivery → Delivered. The customer gets an automatic email when it goes out.",
    chanWarn: "You haven't marked the channel (Shopify, Instagram, TikTok or Web). You can save anyway.", savedNoChannel: "Saved without a channel. You can add it later from the order.",
    repeatOne: "Returning customer · 1 earlier order", repeatMany: "Returning customer · {n} earlier orders", repeatSum: " · {sum} in total",
    sumPrep: "to prepare", sumReady: "ready", sumTransit: "out for delivery", sumDone: "delivered", sumFail: "failed attempts", reschedule: "Reschedule",
    phoneCc: "Phone (+63)", edit: "Edit", editMember: "Edit person", memberSaved: "Saved: {name}", editFail: "Couldn't save", ownRoleHint: "You can't change your own role here.", countryCode: "Country code", otherCode: "Other (type +…)", searchCountry: "Search country or code", noCountry: "No countries found",
    availability: "Availability", available: "Available", unavailable: "Unavailable", awayFrom: "Away from {from}", awayUntil: "Away until {until}", awayOpen: "Away until further notice",
    reason_vacation: "Vacation", reason_rest: "Rest", reason_other: "Other", reasonNone: "Not given", reasonLabel: "Reason (optional)",
    awayFromLabel: "From", awayUntilLabel: "Until (optional)", backNextDay: "\"Until\" is the last day away: back the next day. With no date, away until you change it. Dates in Philippine time.",
    visibleToTeam: "The team sees it when assigning orders", endBeforeStart: "The end date can't be before the start date.", noEndDate: "No end date",
    assignAwayAsk: "{name} isn't available that day", assignAnyway: "Assign anyway", assignAwayDetail: "Away on: {dates} (until {until}).",
    awayConflicts: "Pending orders assigned during an absence: {n}", myAwayOrders: "You have {n} pending order(s) on those dates. Tell the office so they can reassign them.",
    editProfile: "Edit profile", personalData: "Personal details", displayName: "Display name", emailIsLogin: "Sign in with your email or your username. Your email cannot be changed here.", usernamePh: "e.g. maria.flores",
    saveChanges: "Save changes", profileSaved: "Profile saved", doneOrders: "{n} orders delivered", myShop: "My flower shop", online: "Online", doneSince: "Delivered orders you prepared or delivered.", kpiSales: "Sales", bySales: "Sales by channel",
    appTitle: "Orders · Casa de Flores", trackTitle: "Your order · Casa de Flores", skipContent: "Skip to orders", sections: "Sections",
    signIn: "Sign in", signInTitle: "Sign in to Orders", loginHelp: "For the Casa de Flores team.", email: "Email", password: "Password", enter: "Sign in", logout: "Sign out",
    studioTitle: "Every delivery deserves care.", studioIntro: "From our studio to their doorstep. Keep every order in hand.", manilaTime: "Delivery times · Manila (PHT)",
    badLogin: "Wrong username, email or password.", noAccess: "No access", noAccessTxt: "The account {email} isn't on the Casa de Flores team. Ask an admin to add you.",
    tabOrders: "Orders", tabTeam: "Team", tabStats: "Statistics",
    subAdmin: "Admin · {name}", subVendor: "Florist · {name}", subCarrier: "Driver · {name}",
    role_admin: "Admin", role_vendor: "Florist", role_carrier: "Driver",
    branch: "Branch", branchPh: "e.g. Parañaque", branchOf: "Casa de Flores · {b}",
    settings: "Settings", language: "Language", textSize: "Text size", normal: "Normal", large: "Large", theme: "Mode", light: "Light", dark: "Dark", auto: "Auto",
    motion: "Animations", motionFull: "Full", motionReduced: "Reduced", sounds: "Sounds", soundOn: "On", soundOff: "Off",
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
    deliveryNote: "Delivery instructions", deliveryNotePh: "E.g. Tower B, 12th floor, unit 1205. Leave at reception.", deliveryNoteHint: "Floor, tower, reception… Sent to the Lalamove rider with the address.",
    riderNoteOpt: "Instructions for the next attempt (optional)", riderNotePh: "E.g. Call on arrival, the customer will be at reception",
    proofPhoto: "Proof photo", proofHint: "Photo of the door or the delivered bouquet",
    customerLink: "Customer link", linkAfterSave: "The customer link appears once the order is saved.", copy: "Copy", view: "Open", copied: "Link copied", selectCopy: "Select it and copy it",
    fillRequired: "Fill in the fields marked with *.", phoneInvalid: "Check the marked phone: it doesn't look like a Philippine, Spanish or international number.", emailInvalid: "That email doesn't look right.",
    dupNum: "Order #{num} already exists. Use another number.", saveFail: "Couldn't save: {msg}", created: "Order created", saved: "Order saved",
    goneMeanwhile: "This order no longer exists: it was deleted while you were editing.",
    busyRetry: "This order is changing right now. Save again in a moment.",
    st_cancel: "Cancelled", sumCancel: "cancelled", cancelledTag: "Cancelled", cancelledCol: "cancelled (reason)", cancelReasonShort: "Reason:",
    cancelOrder: "Cancel order", cancelTitle: "Cancel order #{num}", cancelReason: "Reason", cancelReasonPh: "Why it is cancelled (the team sees it, the customer doesn't)",
    cancelR1: "Customer cancelled", cancelR2: "Payment not received", cancelR3: "Duplicate order", cancelNeedReason: "Write a reason.",
    cancelHint: "The assigned florist and driver get a notice. The customer's tracking link shows the order as cancelled, without the reason. You can reinstate it at any time.",
    cancelledN: "Order #{num} cancelled", reinstate: "Reinstate", reinstatedN: "Order #{num} reinstated", isCancelled: "This order is cancelled. Reinstate it to move it.",
    cancelledBanner: "Order cancelled", cancelledWork: "Cancelled: don't prepare or deliver it.", ev_cancelled: "Cancelled", ev_reinstated: "Reinstated after cancelling",
    msgCancel: "Hi{name}, your Casa de Flores order #{num} has been cancelled. If you have any questions, just reply to this message. {link}",
    cancelledTrackTitle: "This order has been cancelled", cancelledTrackTxt: "If you weren't expecting this or have any questions, message us on the channel where you placed your order.",
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
    addPerson: "Add person", role: "Role", roleHint: "Florist: their own orders. Driver: deliveries. Admin: everything, including the team.",
    initialPass: "Initial password", passPh: "At least 8 characters", addHint: "Give them the email and this password. If they already had an account in this project, they keep theirs.", add: "Add",
    team: "Team", teamSub: "Florists only see the orders assigned to them.", you: "You", openLoad: "{n} open orders", doneTitle: "Completed", doneToday: "today", doneWeek: "7 days", doneMonth: "this month", doneTotal: "total",
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
  const so = pref("cdf-sound") === "off" ? "off" : "on";
  for (const b of document.querySelectorAll("[data-sound-set]")) b.setAttribute("aria-pressed", String(b.dataset.soundSet === so));
  document.getElementById("pricesBtn")?.setAttribute("aria-pressed", String(pref("cdf-prices") === "on"));
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
// Menus (settings, account): opened with a class so they animate in and out.
// The account menu has views (main list, Preferences, My account); it always opens on the main one.
const openMenu = () => document.querySelector(".settings .menu.open");
const menuOpener = (menu) => menu.parentElement.querySelector("[data-settings]");
const menuItems = (menu) => [...menu.querySelectorAll(".mview:not([hidden]) :is(.mitem, .mback, .seg button), :scope > .mrow .seg button")].filter((b) => !b.hidden && b.getClientRects().length);
let menuReset;
function showMenuView(menu, name, { focus = true, from } = {}) {
  const views = menu.querySelectorAll(".mview");
  if (!views.length) return;
  const cur = menu.querySelector(".mview:not([hidden])"), next = menu.querySelector(`.mview[data-view="${name}"]`);
  if (!next || next === cur) return;
  for (const v of views) v.hidden = v !== next;
  next.classList.remove("in-fwd", "in-back"); void next.offsetWidth;
  next.classList.add(name === "main" ? "in-back" : "in-fwd");
  for (const s of next.querySelectorAll(".seg")) placePill(s);
  if (!focus) return;
  // Into a sub-view: focus "Back". Back to the list: focus the entry that opened that sub-view.
  const target = name === "main" ? next.querySelector(`[data-goto="${from}"]`) : next.querySelector(".mback");
  target?.focus();
}
function setMenu(menu, open, { focusFirst = false } = {}) {
  clearTimeout(menuReset);
  menu.classList.toggle("open", open);
  menuOpener(menu)?.setAttribute("aria-expanded", String(open));
  if (open) {
    showMenuView(menu, "main", { focus: false });
    for (const s of menu.querySelectorAll(".seg")) placePill(s);
    if (focusFirst) requestAnimationFrame(() => menuItems(menu)[0]?.focus());
  } else {
    // Back to the main list once the closing animation is over
    menuReset = setTimeout(() => showMenuView(menu, "main", { focus: false }), 260);
  }
}
function closeMenu(menu, { refocus = false } = {}) {
  const back = menu.contains(document.activeElement);
  setMenu(menu, false);
  if (refocus || back) menuOpener(menu)?.focus();
}
document.addEventListener("click", (e) => {
  const gear = e.target.closest("[data-settings]");
  const cur = openMenu();
  if (gear) {
    const m = gear.parentElement.querySelector(".menu");
    if (cur && cur !== m) setMenu(cur, false);
    // Opened from the keyboard (Enter/Space): move focus into the menu
    setMenu(m, !m.classList.contains("open"), { focusFirst: e.detail === 0 });
    return;
  }
  const go = e.target.closest(".menu [data-goto]");
  if (go) { const m = go.closest(".menu"); showMenuView(m, go.dataset.goto, { from: m.querySelector(".mview:not([hidden])")?.dataset.view }); return; }
  if (cur && !e.target.closest(".settings")) setMenu(cur, false);
  else if (cur && e.target.closest(".mitem")) closeMenu(cur);
  const l = e.target.closest(".lang button"); if (l) { setLang(l.dataset.lang); applyPrefs(); return; }
  const z = e.target.closest("button[data-size]"); if (z) { savePref("cdf-size", z.dataset.size); applyPrefs(); return; }
  const th = e.target.closest("button[data-theme-set]"); if (th) { savePref("cdf-theme", th.dataset.themeSet); applyPrefs(); return; }
  const mo = e.target.closest("button[data-motion-set]"); if (mo) { savePref("cdf-motion", mo.dataset.motionSet === "reduced" ? "reduced" : ""); applyPrefs(); return; }
  const so = e.target.closest("button[data-sound-set]"); if (so) { const on = so.dataset.soundSet === "on"; savePref("cdf-sound", on ? "" : "off"); applyPrefs(); if (on && typeof playSound === "function") playSound("order", true); return; }
});
document.addEventListener("keydown", (e) => {
  const m = openMenu();
  if (!m) return;
  // One Escape closes only the menu (not the phone drawer behind it), and focus goes back to its button
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeMenu(m, { refocus: true }); return; }
  // Arrow keys move between the rows of the visible view; Home/End jump to the ends
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !m.contains(document.activeElement) && document.activeElement !== menuOpener(m)) return;
  const items = menuItems(m); if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
  e.preventDefault(); items[n].focus();
});
// Tabbing out of an open menu closes it
document.addEventListener("focusin", (e) => { const m = openMenu(); if (m && !m.parentElement.contains(e.target)) setMenu(m, false); });
applyStatic();
applyPrefs();
