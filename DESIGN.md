---
name: Pedidos · Casa de Flores
description: Despacho floral en gris casi negro, acciones blancas y color solo para el estado de cada pedido, sobre una línea temporal.
colors:
  bg: "#171717"
  chrome: "#1c1c1c"
  surface: "#232323"
  hover: "#2d2d2d"
  line: "#343434"
  line-soft: "#282828"
  fg: "#f1f1f1"
  muted: "#999999"
  faint: "#8a8a8a"
  primary: "#f1f1f1"
  on-primary: "#171717"
  focus: "#d4d4d4"
  state-prep: "#e6b86a"
  state-ready: "#8db7c9"
  state-transit: "#a99fe6"
  state-done: "#65bd91"
  state-fail: "#e07b7b"
  channel-shopify: "#238d61"
  channel-instagram: "#b34283"
  channel-tiktok: "#0b0c0d"
  light-bg: "#f7f7f6"
  light-chrome: "#f0f0ef"
  light-surface: "#ffffff"
  light-hover: "#f1f1f0"
  light-line: "#e2e2e0"
  light-fg: "#171717"
  light-muted: "#5c5c5c"
  light-faint: "#737373"
  light-state-prep: "#8a5a14"
  light-state-ready: "#2e6a80"
  light-state-transit: "#5b4ba8"
  light-state-done: "#2e7d57"
  light-state-fail: "#b0433a"
typography:
  brand:
    fontFamily: 'Newsreader, Georgia, serif'
    fontSize: "1.3rem"
    fontWeight: 500
    letterSpacing: "-.01em"
  headline:
    fontFamily: 'Newsreader, Georgia, serif'
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-.015em"
  display:
    fontFamily: 'Newsreader, Georgia, serif'
    fontSize: "2.4rem"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-.02em"
  title:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".8125rem"
    fontWeight: 500
  small:
    fontFamily: 'Geist, "Segoe UI", system-ui, sans-serif'
    fontSize: ".75rem"
    fontWeight: 400
rounded:
  sm: "6px"
  control: "8px"
  card: "12px"
  login: "16px"
  pill: "99px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
motion:
  fast: "150ms"
  base: "200ms"
  slow: "260ms"
  ease-out: "cubic-bezier(.16,1,.3,1)"
  ease-in: "cubic-bezier(.4,0,1,1)"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.control}"
    padding: "0 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
  field:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  order:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  stat-filter:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    padding: "20px 24px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    rounded: "{rounded.card}"
    padding: "22px"
---

# Design System: Pedidos · Casa de Flores

## Overview

**Norte creativo: "Un despacho floral tranquilo, donde solo el estado tiene color."**

Fondo gris casi negro (#171717), barra superior un punto más clara (#1C1C1C), superficies #232323 y bordes finos #343434. Las acciones principales son blancas con texto oscuro; el color se reserva para el estado de cada pedido (Preparando ámbar, Listo azul grisáceo, En camino lavanda, Entregado verde, No había nadie coral) y para los logotipos de cada canal. La marca vive en la serif Newsreader (nombre de la tienda, títulos del día y de cada pedido) y en el emblema floral existente; todo lo funcional va en Geist.

Una sola hoja de estilos (`styles.css`) sirve al panel y a la página pública de seguimiento. Los tokens están arriba del archivo y todo lo demás los usa; el tema claro redefine los mismos tokens.

## Estructura

- **Barra superior**: emblema + "Casa de Flores" en serif, pestañas Pedidos / Estadísticas / Equipo (solo admin), ajustes y cuenta.
- **Pedidos (oficina)**: columna izquierda con calendario (el fondo de cada día se aclara en tres niveles según los pedidos), "Nuevo pedido", filtros por estado y herramientas (archivar entregados, ver archivados, exportar CSV). A la derecha: búsqueda en todas las fechas, contadores que también filtran (incluido "En riesgo"), título del día en serif y la línea temporal: hora a la izquierda con un punto del color del estado y la tarjeta del pedido.
- **Tarjeta de pedido**: identidad (foto, nº, canal, destinatario), contacto (teléfono, dirección, nota, florista editable en la propia tarjeta), la línea de progreso como único control de estado y la siguiente acción como botón principal. La vista compacta oculta la línea de progreso y la nota.
- **Florista y repartidor**: una columna de tarjetas grandes por día (atrasados, hoy, mañana, próximos), un botón grande por paso y llamar / WhatsApp / mapa.
- **Hojas laterales** para editar y para los pasos con formulario (listo con foto, entrega con prueba, no había nadie con nueva fecha). **Diálogos** centrados y breves para confirmar lo que tiene consecuencias (correo al cliente, volver atrás, borrar, descartar cambios).
- **Estadísticas**: una franja de seis indicadores, pedidos por día (barras verticales con tabla equivalente para lectores de pantalla) y barras horizontales por canal, florista y franja. Un solo color neutro por gráfico, valores siempre escritos.
- **Seguimiento público**: logotipo, tarjeta con el pedido, foto del ramo, mensaje de la tarjeta y pasos con iconos; mensajes florales aprobados.

## Reglas

- Texto mínimo 12px (.75rem); cuerpo 14px; controles de 40px, 44px en pantallas táctiles.
- Sin bordes laterales de color, sin tarjetas anidadas, sin degradados de texto. El riesgo se marca con un borde fino teñido y una etiqueta, nunca solo con color.
- Números en cifras tabulares; selección, cursor, foco y barras de desplazamiento con los colores del sistema.
- Movimiento: 150–260 ms, salida exponencial, sin rebotes. Hoja lateral que entra desde la derecha, diálogos que aparecen con una ligera escala, tarjetas que suben 4px al aparecer, puntos de estado que cambian de color. **Siempre activas**; solo se reducen si la persona elige "Animaciones: Reducidas" en Ajustes (no se usa el ajuste del sistema operativo).
- Claro / oscuro / auto, tamaño de letra normal o grande, idioma ES / EN: preferencias del visitante, recordadas en su navegador.
