---
name: Pedidos · Casa de Flores
description: Despacho floral en grafito, con acciones lavanda y pedidos sobre una línea temporal.
colors:
  dark-bg: "#191a1e"
  dark-surface: "#24262c"
  dark-sunk: "#2d3038"
  dark-line: "#41454f"
  dark-fg: "#f4f2ed"
  dark-muted: "#babcc8"
  paper: "#c7c2ff"
  paper-ink: "#242138"
  dark-focus: "#d8d3ff"
  dark-prep: "#efca88"
  dark-prep-bg: "#343028"
  dark-ready: "#91d7c5"
  dark-ready-bg: "#263731"
  dark-transit: "#afc5ff"
  dark-transit-bg: "#2c3144"
  dark-done: "#a7d8ad"
  dark-done-bg: "#2a372e"
  dark-fail: "#f2a7a4"
  dark-fail-bg: "#3b2c30"
  dark-danger: "#f2a7a4"
  dark-danger-bg: "#3b2c30"
  light-bg: "#eef4f0"
  light-surface: "#ffffff"
  light-sunk: "#e5ede8"
  light-line: "#cad7cf"
  light-fg: "#13302a"
  light-muted: "#50645b"
  channel-shopify: "#238d61"
  channel-instagram: "#b34283"
  channel-tiktok: "#090b0c"
  light-action: "#514d83"
  light-focus: "#514d83"
  light-danger: "#ad3018"
  light-danger-bg: "#fbe6df"
  light-prep: "#87501d"
  light-prep-bg: "#faf0dc"
  light-ready: "#286478"
  light-ready-bg: "#e7f1f4"
  light-transit: "#65509a"
  light-transit-bg: "#efeafa"
  light-done: "#22633f"
  light-done-bg: "#e0efe4"
  light-fail: "#865000"
  light-fail-bg: "#fff0cf"
typography:
  display:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-.035em"
  headline:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-.025em"
  title:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: "1.3rem"
    fontWeight: 600
    letterSpacing: "-.02em"
  body:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".8rem"
    fontWeight: 550
  order-number:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".92rem"
    fontWeight: 550
rounded:
  progress: "4px"
  filter: "7px"
  control: "9px"
  selector: "10px"
  calendar: "11px"
  summary: "12px"
  order: "13px"
  tracking: "14px"
  login: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  compact: "12px"
  md: "16px"
  card: "20px"
  section: "24px"
  wide: "32px"
components:
  button-primary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.dark-fg}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-danger:
    backgroundColor: "{colors.dark-danger-bg}"
    textColor: "{colors.dark-danger}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  field:
    backgroundColor: "{colors.dark-bg}"
    textColor: "{colors.dark-fg}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  sidebar-filter:
    backgroundColor: "transparent"
    textColor: "{colors.dark-muted}"
    rounded: "{rounded.filter}"
    padding: "6px 12px"
  order:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-fg}"
    rounded: "{rounded.order}"
    padding: "18px 20px"
  work-card:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-fg}"
    rounded: "{rounded.order}"
    padding: "20px"
  summary:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-fg}"
    rounded: "{rounded.summary}"
    padding: "20px 16px"
---

# Design System: Pedidos · Casa de Flores

## Overview

**Creative North Star: "Despacho floral sobre una línea temporal"**

La referencia aprobada se adapta a las funciones reales: calendario y filtros laterales, resumen del día, horario en un margen propio y tarjetas con identidad, contacto, estado y detalle. El grafito neutro y las acciones lavanda mantienen una lectura tranquila; emblema y logotipos florales existentes aportan identidad.

Este registro sigue la cascada `styles.css` → `reference.css` → `integration.css`, los flujos de `app.js`, el adaptador `ui.js` y las capturas de revisión del repositorio actualizado desde origin/main f5ff388. Conserva acceso, equipo, editor, agendas accionables de florista/repartidor y mensajes florales del seguimiento. No incorpora secciones ni datos inexistentes, ni raster nuevos. Las marcas de canal incorporan SVG locales con procedencia registrada.

**Key Characteristics:**
- Fondo grafito, tarjetas oscuras y bordes finos.
- Acción principal lavanda y progreso con estado escrito.
- Tiempo separado de identidad, contacto y acciones.
- Densidad Timeline/Compact y adaptación móvil.

## Colors

Los tokens oscuros describen el inicio, la elección explícita Oscuro y Auto cuando el sistema es oscuro; los claros, Claro y Auto cuando el sistema es claro. La última decisión delega los colores y conserva únicamente el suelo gris oscuro como restricción cromática; sustituye la paleta previa de marca y la marfil de la referencia.

### Primary

- **Lavanda suave:** `paper` para acciones principales, detalle, día seleccionado y selección de densidad; `paper-ink` para su texto. En Claro, el token CSS `--paper` usa `light-action`, lavanda profunda, y `--paper-ink` blanco.
- **Tinta cálida:** `dark-fg` aporta el blanco cálido de lectura sobre grafito. Los colores del logotipo existente no limitan las acciones ni los estados.

### Secondary

- **Preparación ámbar, listo verde azulado, tránsito azul suave, entregado verde e intento coral:** parejas de tinta/fondo para selector, insignia y señales de pedido. Los filtros repiten el color en icono y contador.
- **Intento público ámbar:** el seguimiento usa la pareja de preparación del tema actual, junto al mensaje floral aprobado. No hereda el coral administrativo.
- **Foco y destrucción:** foco lavanda claro en Oscuro y profundo en Claro. Eliminar comparte la pareja coral en Oscuro y conserva su pareja cálida heredada en Claro.
- **Resumen:** las cinco tarjetas usan superficie gris neutra; la señal cromática se limita al icono y a su apoyo tenue. Estas tarjetas resumen categorías y no redefinen el estado del pedido.

### Neutral

- **Grafito:** `dark-bg` en página, encabezado y campos de editor; `dark-surface` en tarjetas/paneles; `dark-sunk` para apoyos; `dark-line` para contornos; `dark-fg` y `dark-muted` para texto.
- **Claro:** página White Glove, superficie blanca, apoyos verde gris muy claro, tinta verde y borde suave; las parejas `light-*` mantienen la lectura de estados.

**The Oscuro inicial Rule.** Sin preferencia guardada se aplica Oscuro. Claro y Oscuro son elecciones explícitas; Auto sigue el sistema operativo.

**The Estado con palabras Rule.** Color, icono y etiqueta acompañan el estado; un intento no se presenta como entrega completada.

## Typography

**Display Font / Body Font:** Geist con Segoe UI y sans-serif como fallback. El número de pedido también usa Geist en la adaptación actual; no heredar la anterior regla de números monoespaciados.

**Cabecera observada:** el nombre de marca usa Georgia/Times New Roman, peso 400, 1.8rem e interlineado 1.15; se reduce a 1.6rem y 1.35rem. Es la solución implementada para el carácter serif de la referencia, no una fuente display general que deban heredar otras superficies.

Geist Mono sigue cargada y aparece en campos auxiliares que conservan esa declaración; no se añade otra fuente. Los pesos cargados son 400, 500, 600 y 700; el CSS solicita además 550/650 en algunos elementos.

### Hierarchy

- **Display:** relato del acceso; 1.7rem bajo 560px.
- **Headline:** jornada en 2rem; 1.8rem bajo 1450px y 1.25rem bajo 560px.
- **Title:** tarjeta ordinaria; seguimiento en 1.4rem. Sheet en 1.15rem.
- **Body:** texto operativo compacto; nombre de destinatario en 1.08rem, 1rem móvil.
- **Label:** campo en .8rem; metadatos y progreso entre .58 y .88rem según componente/ancho. Estos tamaños describen la implementación y no constituyen por sí solos una garantía de legibilidad.
- **Texto grande:** tamaño raíz de 16px a 19px; campos móviles de 1rem.

## Layout

Máximo general de 1680px con 24px laterales. Escritorio: barra lateral de 350px y contenido flexible; separación de 24px, 22px bajo 1450px. Calendario fijo a 20px. Bajo 900px pasa a una columna, margen lateral de 16px y calendario desplegable; bajo 860px su cuerpo expandido recibe el espaciado heredado.

La búsqueda y el filtro nativo de estado encabezan el contenido; bajo 560px comparten una fila con filtro de 124px y controles de 48px. Fecha y densidad también comparten fila en móvil. Admin y moderator: cinco tarjetas de resumen. Florista y repartidor usan su agenda de trabajo, con búsqueda, resumen, calendario lateral y densidad ocultos; no son una variante de consulta del anterior vendedor. Cinco columnas en escritorio, tres bajo 1200px y cinco bajo 900px. Bajo 560px pasan a una fila horizontal sin salto, con scroll y ajuste suave por tarjeta: 142px de anchura y mínimo de 76px de altura; la ayuda secundaria se oculta.

Cada entrada reserva 68px al horario, 60px bajo 1200px y 42px bajo 560px. La tarjeta reparte identidad, contacto y selector en la primera banda, con progreso y acciones debajo. Bajo 1200px distribuye más filas; en móvil apila identidad, contacto/dirección, estado, progreso y acciones, con la nota breve oculta. Las miniaturas pasan de 76×80px a 65×75px y 48×58px según ancho.

Timeline muestra progreso y nota; Compact los oculta y reduce miniatura/padding, sin cambiar datos ni permisos. El editor lateral llega a 640px y usa toda la anchura disponible en móvil. Acceso de dos columnas hasta 980px, apilado bajo 560px. Seguimiento hasta 620px. Respetar las áreas seguras del dispositivo.

## Elevation & Depth

Predominan tono y contorno de 1px; las tarjetas de pedido son independientes, sin la anterior caja compartida de filas. La sombra heredada (`0 12px 36px rgb(0 0 0 / .18)`) se reserva al menú de preferencias y al toast. El editor usa velo negro al 40% y entrada lateral de 40px en .22s con `cubic-bezier(.16,1,.3,1)`, solo sin preferencia de reducción de movimiento.

**The Profundidad funcional Rule.** Separar contenido cotidiano con tono y línea; reservar elevación para capas temporales.

## Shapes

Radios de control próximos a 9–11px, tarjetas de resumen de 12px, pedido/panel de 13px, seguimiento de 14px y acceso de 16px. Los nodos de progreso, marcadores horarios, fondos de icono de resumen y avatar son circulares; esta geometría es nativa de la referencia y no debe prohibirse. La línea temporal y el progreso usan conectores rectos. La carga de foto y el vacío conservan contornos discontinuos.

## Components

### Buttons

Principal lavanda con tinta oscura, secundario transparente con borde, ghost sin contorno visible y destructivo con pareja propia. Altura mínima general de 46px; navegación y otros controles conservan mínimos de 44px. Hover principal/detalle oscurece mediante brillo .95; secundario usa apoyo tonal. Foco visible heredado de 3px y separación de 3px. Deshabilitado reduce opacidad a .6.

### Chips

El filtro lateral es ahora una fila de tres columnas: SVG, etiqueta y contador. Mínimo de 44px, radio de filtro y fondo transparente; activo/hover sobre apoyo tonal. Activo añade tinta principal y borde lavanda; se conserva el refuerzo de borde heredado. Los contadores tienen cápsula propia con color semántico. El canal es una cápsula pequeña, informativa y sin interacción. Shopify, Instagram y TikTok muestran su marca oficial SVG blanca en una caja de 18px con radio de 4px, sobre los tokens de canal verde, magenta y casi negro; Web usa un globo lineal. Los paths proceden de Simple Icons 15.0.0, están incorporados en el código y conservan originales/procedencia en `img/channels/`; la etiqueta visible siempre permanece.

### Cards / Containers

Pedido con borde, radio y áreas explícitas: identidad abrible, teléfono/dirección/nota, selector o insignia, cuatro nodos de progreso y acciones. El placeholder sigue siendo el emblema existente. Nota de tarjeta truncada con puntos y oculta en móvil; el detalle conserva el texto completo. Resumen con número grande, etiqueta, ayuda e icono circular. No convertirlo en analítica ni inventar métricas.

### Work agendas

Las agendas de florista y repartidor usan tarjetas de superficie con radio de 13px, padding de 20px y separación interior de 18px; en móvil, padding de 16px y separación de 14px. Imagen de 76×84px (54×66px móvil), horario, número, canal e insignia preceden destinatario/dirección. Mensaje de tarjeta y notas se apoyan sobre el fondo grafito. Las acciones principales de trabajo miden al menos 48px y ocupan una fila completa en móvil; las de llamada, WhatsApp y mapa comparten la fila inferior. Entregados conservan opacidad .8. La agenda de florista contempla atrasados, hoy, mañana y próximos siete días; la del repartidor prioriza atrasados y hoy.

### Inputs / Fields

Campo de editor sobre `--bg`, borde y radio de control, padding de 10px 12px y mínimo de 44px; textarea de al menos 88px. Etiqueta externa en caja natural. Búsqueda de 54px, radio de calendario y espacio para lupa dibujada en CSS; su etiqueta permanece accesible pero visualmente oculta. Filtro de estado nativo de 54px, 48px móvil junto a la búsqueda. Placeholder con tinta secundaria y opacidad completa. Error textual con `role="alert"`. El editor agrupa destinatario/teléfono/dirección/mensaje de tarjeta, comprador/contacto y detalles internos; usa líneas de sección con encabezados de .95rem. La franja libre combina cuatro selectores nativos de hora/minuto, de al menos 44px, que se ajustan a varias líneas. No sustituirla por los antiguos presets.

### Navigation

Cabecera con marca, Pedidos y Equipo según permiso, ajustes, inicial y salida. Solo admin dispone de gestión de equipo; moderator trabaja con pedidos sin equipo ni borrado. Pestaña activa con subrayado de 2px lavanda; sin el antiguo bloque segmentado verde. Bajo 900px las pestañas pasan a una fila completa; avatar oculto bajo 560px. Timeline/Compact usa selector segmentado e inversión de tinta. Preferencias conservan idioma, tamaño y tema con `aria-pressed`.

### Calendar

Siete columnas, días de 47px y objetivos mínimos de 44px. Selección lavanda con tinta oscura, hoy con borde y puntos para volumen. Flechas de 46px y acciones inferiores de 48px. En móvil comienza contraído, con `aria-expanded`; los filtros viven dentro del área desplegable y el filtro superior permite acceder al estado sin abrirla.

### Order status and progress

Admin y moderator disponen de selector nativo con los cinco estados y cuatro nodos accionables: preparar, listo, tránsito y entregado; el último se sustituye por intento cuando corresponde. Mientras guarda, bloquea sus controles; si falla restaura los valores anteriores y avisa. En las agendas de florista/repartidor, la acción siguiente depende del estado y del rol: marcar listo con foto del ramo; salir a reparto; confirmar entregado con prueba/nota; o reprogramar cuando no hay nadie. La interfaz conserva las operaciones RPC existentes y no redefine sus permisos. Mapa, teléfono y WhatsApp aparecen cuando corresponden; el detalle mantiene una lectura separada de los controles operativos. La línea del progreso permanece gris; puntos y etiqueta actual usan la tinta del pedido.

### Sheet

Diálogo modal con foco inicial, contención de Tab, Escape y restauración del foco. El borrado conserva confirmación explícita; no atribuir a esta integración una protección de borradores que el código actual no implementa. Anchura máxima de 640px, scroll vertical propio, sin desbordamiento horizontal. Cabecera y pie separados por línea; separación de 20px entre bloques. Los diálogos breves de listo, entrega y reprogramación comparten el mismo panel, encabezado y pie de cancelar/confirmar. Listo admite foto de ramo; entrega admite prueba/nota; reprogramación añade fecha y franja libre y devuelve el pedido a Ready. Florista y repartidor tienen acciones de escritura acotadas; no aplicar la antigua regla de vendedor de solo lectura.

### Tracking and icons

El seguimiento actual presenta número, fecha/franja y destinatario, después foto del ramo y mensaje de tarjeta si existen, y el timeline vertical de cuatro pasos. Mantiene actualización en hora de Manila. SVG lineales de 16–25px según rol, trazos de 1.6–1.7; nunca caracteres usados como pictogramas. Nodos públicos circulares, actual lavanda e intento ámbar con explicación aprobada. Nota de entrega y prueba aparecen después del timeline cuando existen. Ramo y prueba proceden de URLs temporales entregadas por el endpoint existente `cdf-track`; las capturas internas permanecen separadas. No registrar las fotos como recursos públicos permanentes. Recursos raster de identidad existentes sin cambios.

### Notification history

Historial desplegable, separación de 8px y divisores de fila. Cabecera con fecha/hora, destinatario/canal y estado; la fecha ocupa su propia fila en móvil. Objetivo del summary de al menos 44px, cuerpo de mensaje sobre grafito con padding de 12px, fallos en tinta coral. Conservar el historial existente y el aviso del correo automático al pasar a In transit; no presentarlos como funciones nuevas ni afirmar que el backend se ha validado.

### Toasts

Aviso centrado a 20px más área segura del pie; ancho máximo del viewport menos 32px, padding de 12px 18px, radio heredado de 8px, tinta/fondo invertidos y sombra temporal. `role="status"`, `aria-live="polite"`, 2600ms. Error de carga persistente dentro del contenido, con reintento.

## Do's and Don'ts

### Do:
- **Do** iniciar en grafito y ofrecer Claro, Oscuro y Auto como preferencias.
- **Do** conservar acciones lavanda, horario lateral y estados escritos en las superficies adaptadas.
- **Do** respetar los cuatro roles actuales y conservar sus acciones de preparación, entrega y reprogramación.
- **Do** conservar mensajes florales públicos, imágenes originales y errores recuperables.

### Don't:
- **Don't** recuperar el verde como fondo oscuro ni los botones verdes como principal oscuro.
- **Don't** extender la cabecera serif a todos los títulos ni recuperar números Mono en las tarjetas adaptadas.
- **Don't** añadir productos, clientes, analítica, mapa agregado o fotos de ramos inexistentes.
- **Don't** usar el coral administrativo para sustituir el intento público ámbar.

No canonizado ni reparado: Georgia es la solución de sistema observada en la marca, no una fuente display para extender. El adaptador final sustituye las antiguas marcas de texto/emoji de las agendas por SVG antes de mostrarlas; no queda esa excepción en el resultado visible. Auto oscuro comparte la paleta grafito/lavanda mediante su media query explícita. Este pase describe el código, no aprueba el acabado ni certifica WCAG; las pruebas disponibles son sintéticas.
