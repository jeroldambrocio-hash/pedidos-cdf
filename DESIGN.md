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
  faint: "#959595"
  primary: "#f1f1f1"
  primary-hover: "#ffffff"
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
  light-line-soft: "#ebebea"
  light-fg: "#171717"
  light-muted: "#5c5c5c"
  light-faint: "#686868"
  light-primary: "#171717"
  light-primary-hover: "#000000"
  light-on-primary: "#ffffff"
  light-focus: "#171717"
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
  xs: "4px"
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

Se conserva la dirección aprobada: superficies neutras, marca floral existente, serif Newsreader en los títulos y Geist en el trabajo diario. El panel coordina la preparación y entrega con una línea temporal; no se convierte en un tablero de columnas.

## Colors

Los tokens del frontmatter describen la paleta. El fondo, las superficies y los bordes son neutros; estado y logotipos de canal aportan color. La variante clara cambia los mismos papeles. Los textos secundarios y las etiquetas de reintento tienen pares de contraste revisados en ambos temas.

## Typography

Newsreader identifica la marca y las cabeceras; Geist sirve para nombres, controles y datos. La escala funcional usa rem y herencia: «Texto grande» aumenta también campos, filtros, teléfonos y descripciones, no solo títulos. Los campos táctiles parten de 1rem para evitar el zoom automático de iOS. Las cifras usan alineación tabular.

## Layout

La navegación de escritorio ocupa 56px plegada o 200px desplegada, y el contenido reserva exactamente ese espacio. Hasta 860px se convierte en un cajón temporal: el fondo queda inactivo, el foco permanece dentro y se devuelve al botón de apertura. El cajón se cierra antes de abrir un formulario de cuenta.

La oficina tiene calendario y filtros a la izquierda; búsqueda, resumen de lectura y tarjetas a la derecha. La rejilla responde al espacio que queda tras la navegación. Hasta 560px los pasos mantienen sus nombres accesibles y muestran nodos sin etiquetas repetidas para caber en 320px. La tarjeta conserva estado escrito y siguiente acción. La vista compacta reduce contenido secundario.

## Elevation & Depth

Las superficies se separan con cambios tonales y bordes finos. Los menús y formularios temporales añaden sombra. Sus velos y capas se coordinan con la navegación móvil para que un menú no tape el formulario que acaba de abrir.

## Shapes

Los radios del frontmatter se mantienen: controles pequeños, tarjetas con curva moderada y etiquetas de estado en píldora. Los iconos usan un trazo SVG coherente. No se añaden franjas decorativas de color al borde de las tarjetas.

## Components

- **Navegación:** Pedidos, Estadísticas y Equipo; los dos últimos son del administrador. Menú de cuenta con preferencias, contraseña, sugerencias y salida.
- **Filtros:** estado y canal con contadores interactivos en la columna izquierda. El resumen junto al día es informativo.
- **Tarjetas:** hora, foto, número, canal, destinatario, contacto, florista y siguiente acción. El estado se puede elegir en la etiqueta o en la línea de pasos, siempre por el mismo flujo de confirmaciones.
- **Formularios:** hojas laterales con etiquetas asociadas, errores, guardado en curso y borrador. Las secciones de destinatario e historial abren con movimiento breve; la interacción sigue disponible.
- **Estadísticas:** seis indicadores, comparación con el periodo anterior, gráficos por canal, día/semana, hora y florista, mejores clientes e ideas derivadas de datos. Los importes solo se consultan con permiso real de administrador.
- **Seguimiento:** una variante del logo según tema; tarjeta, foto del ramo, mensaje, pasos y prueba. Solo el estado actual anima su icono: corte, balanceo, conducción, latido o aviso intermitente.
- **Movimiento:** transiciones de pantalla, menús, hojas, filtros y listas; realce de altas/cambios; salida de borrados; crecimiento de gráficos. Las preferencias completas se conservan por defecto y Reducidas desactiva los bucles y sustituye entradas por fundidos breves. No se usa la preferencia del sistema para anular la decisión explícita aprobada.

## Do's and Don'ts

- Mantener el lenguaje visual y los recursos de identidad existentes.
- Comprobar escritorio, móvil estrecho, tema claro, texto grande y movimiento reducido.
- Asociar las etiquetas visibles con sus controles y conservar foco y nombres accesibles.
- Coordinar cada cambio de estado con su efecto real, incluido correo y prueba de entrega.
- No dar por incorporado un comportamiento porque su CSS exista: verificar el elemento y el activador real.
- No mostrar ni exportar importes por el simple hecho de que una columna exista.
