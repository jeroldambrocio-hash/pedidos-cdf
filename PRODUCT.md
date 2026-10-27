# Pedidos · Casa de Flores
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Admin gestiona todos los pedidos, el equipo y las estadísticas. Moderator gestiona pedidos sin equipo ni borrado. Vendor es florista: ve sus pedidos, prepara el ramo, adjunta su foto y avanza mediante RPC. Carrier es repartidor: ve los pedidos listos sin asignar o asignados a él, sale a repartir (y así se lo queda), entrega o reprograma. El cliente consulta un enlace público sin cuenta.

## Product Purpose
Coordinar pedidos de flores desde varios canales hasta su preparación y entrega en Filipinas, con el menor número de pasos y sin errores que lleguen al cliente.

## Operating Context
Hora Asia/Manila (la fecha de "hoy" avanza sola a medianoche de Manila). Interfaz ES/EN. Los mensajes al cliente van siempre en inglés. Canales Shopify (con importación automática por webhook), TikTok, Instagram y web.

## Capabilities and Constraints
HTML/CSS/JavaScript vanilla sin build: `index.html` + `js/*.js` (núcleo, iconos, fotos, hojas, pedidos, agenda, equipo, estadísticas, arranque), `i18n.js`, una sola `styles.css`, `seguimiento.html` + `tracking.js`. Supabase (supabase-js 2.45.4 fijado con SRI) y Netlify estático. Funciones: alta con franja libre, comprador y destinatario separados, tarjeta, foto privada de referencia, foto del ramo, prueba de entrega, historial de avisos, historial de cambios, correo automático al pasar a En camino, archivo en lugar de borrado, exportación CSV, acciones masivas, pedidos en riesgo, estadísticas. RPC cdf_progress / cdf_set_bouquet / cdf_reschedule y endpoint cdf-track con URLs temporales. Migraciones 012 (archivo e historial) y 013 (repartidor asignado y reglas del flujo) deben aplicarse antes de desplegar esta interfaz; el panel funciona igualmente sin ellas, sin esas funciones.

## Brand Commitments
Marca serif (Newsreader) con el emblema existente. Calendario y filtros a la izquierda, resumen arriba y pedidos en línea temporal con tarjetas; no volver al tablero de columnas. Paleta neutra elegida por el propietario el 27 de octubre de 2026: fondo #171717, barra #1C1C1C, superficies #232323, hover #2D2D2D, bordes #343434, texto #F1F1F1 y #999999; completado #65BD91, pendiente #E6B86A, incidencia #E07B7B. Logos de canal junto a sus nombres. Mensajes florales del seguimiento aprobados. Preferencias de idioma, tamaño, claro/oscuro/auto y animaciones (siempre completas salvo que la persona elija reducirlas).

## Evidence on Hand
Código completo, migraciones 001–013, funciones cdf-notify, cdf-track, cdf-users y cdf-shopify. `tests/ui-smoke.cjs` prueba el panel y el seguimiento contra un Supabase falso (sin peticiones reales). No hay credenciales de producción de prueba.

## Product Principles
Mostrar primero hora, destinatario, dirección y siguiente acción. Pedir confirmación solo donde hay consecuencias para el cliente (correo, estado visible, borrado) y nunca perder lo escrito. Respetar permisos por rol también en el servidor. Separar capturas internas de fotos públicas. Revisión previa a cualquier publicación: el usuario autoriza cada despliegue.

## Accessibility & Inclusion
Foco visible, nombres accesibles, teclado (Ctrl/⌘+K buscar, N nuevo pedido, T hoy, ←/→ día), diálogos que retienen el foco, controles de 40px (44px táctil), texto mínimo 12px y ampliable, gráficos con tabla equivalente. Las pruebas sintéticas no constituyen certificación WCAG ni validan las políticas reales del servidor.
