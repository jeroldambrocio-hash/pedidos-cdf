# Pedidos · Casa de Flores
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Admin gestiona todos los pedidos y el equipo. Moderator gestiona pedidos sin equipo ni borrado. Vendor es florista: ve sus pedidos y puede preparar el ramo, adjuntar su foto y avanzar mediante RPC. Carrier es repartidor: ve pedidos Ready y trabaja en tránsito, entrega y reprogramación. El cliente consulta un enlace público sin cuenta.

## Product Purpose
Coordinar pedidos de flores desde capturas de varios canales hasta su preparación y entrega en Filipinas.

## Operating Context
Hora Asia/Manila. Interfaz ES/EN. Los mensajes enviados al cliente permanecen en inglés conforme a la versión actual del repositorio. Canales Shopify, TikTok, Instagram y web.

## Capabilities and Constraints
Base actual origin/main f5ff388, obtenida el 27 de octubre de 2026. HTML/CSS/JavaScript vanilla, sin build, Supabase CDN fijado y Netlify estático. Conservar funciones actuales: alta con franja libre, comprador y destinatario separados, tarjeta, foto privada de ramo, prueba privada de entrega, historial de avisos, correo automático al pasar a In transit, RPC cdf_progress/cdf_set_bouquet/cdf_reschedule y endpoint cdf-track con URLs temporales. No modificar backend, tablas, columnas, migraciones, RLS ni ejecutar SQL.

## Brand Commitments
El usuario aprobó explícitamente el formato de la previsualización: marca serif con emblema existente, calendario y filtros a la izquierda, resumen arriba y pedidos en línea temporal con tarjetas; no volver al tablero de columnas como vista principal. Rechazó las restricciones de paleta previas y delegó el color, exigiendo fondo gris oscuro: grafito #191a1e, superficie #24262c, acción lavanda #c7c2ff e información marfil. Logos de canal junto a sus nombres. Mantener los mensajes florales del seguimiento aprobados. Preferencias de idioma, tamaño y claro/oscuro/auto.

## Evidence on Hand
Código completo del repositorio actual y diseño aprobado en la copia anterior. Capturas y pruebas usan datos ficticios; no hay credenciales de producción de prueba. Los cuatro PNG de identidad se conservan. Marcas SVG de Simple Icons 15.0.0 documentadas en img/channels/SOURCES.md.

## Product Principles
Conservar las funciones más recientes mientras se cambia su presentación. Mostrar tiempo, destinatario y dirección con prioridad. Respetar permisos por rol. Separar capturas internas de fotos públicas autorizadas por enlaces temporales. Mantener revisión previa a publicación: el usuario no ha autorizado despliegue.

## Accessibility & Inclusion
Foco visible, nombres accesibles, teclado, controles de 44px y texto ampliable. Las pruebas sintéticas no constituyen certificación WCAG ni validación de las políticas reales del servidor.
