# Corrección de integración · 28/10/2026

## Preparado y probado

La rama `codex/complete-redesign-integration` completa la integración conservando el diseño aprobado. Incluye los iconos animados del seguimiento (corte, ramo, camión, corazón y aviso), logo por tema, texto grande funcional, etiquetas accesibles, navegación móvil y adaptación estrecha, estadísticas completas y sus definiciones, actualización de caché, búsqueda normalizada e historial del comprador, activadores de movimiento, CSV sin precios para otros roles e historial privado de importes.

Validación: 35 comprobaciones de navegador con datos ficticios, 15 comprobaciones SQL en PostgreSQL temporal y mediciones adicionales de ancho, foco, tamaño y contraste. El fichero `tests/db-regression.cjs` no conecta con producción. Las comprobaciones de navegador no certifican Safari físico ni envíos reales.

## Ya completado en producción por otra sesión

Se verificaron la columna y reglas de la 013 y `cdf-notify` v9. No se volvió a desplegar esa función ni se sustituyeron esas reglas como parte de esta entrega. `main` sigue en `1629959` durante la preparación.

## Pendiente de aprobación

La revisión automática rechazó la nueva escritura de producción y señaló que era necesaria autorización explícita para reanudarla después de la preocupación del propietario. No se ejecutó la migración nueva y no se publicó este cliente.

El paso exacto pendiente es `supabase/migrations/20261028012537_secure_prices_and_search.sql`:

1. Crear una copia protegida de los importes existentes y copiarlos a `cdf_order_prices`, con políticas de administrador.
2. Comprobar que todos los importes se conservaron; dejar vacía y protegida la columna antigua para que los precios no se filtren al consultar pedidos. No borrar esa columna, tablas ni pedidos.
3. Registrar cambios de precio en eventos que solo el administrador puede leer.
4. Añadir búsqueda sin acentos e historial completo del comprador con las políticas del usuario.
5. Comprobar asignación de repartidor sobre la fila bloqueada para impedir reclamaciones concurrentes.

Después: verificar el servidor, integrar la rama y publicar el cliente en el sitio existente `pedidos-cdf`. La búsqueda y el historial nuevo dependen de la migración; no publicar el cliente antes. No activar el webhook de Shopify sin su configuración independiente.

## Relación con la auditoría

| Hallazgo | Estado de esta entrega |
|---|---|
| 01 · 013 y 02 · cdf-notify | Completados externamente y verificados; no duplicados. |
| 03 · permisos de precios y 17 · historial de importes | Código y migración probados localmente; pendientes de aplicar en servidor. |
| 04–08 · menú, etiquetas, tamaño, logo e iconos | Corregidos y comprobados en navegador. |
| 09–13 · estadísticas, caché, historial y búsqueda | Cliente corregido; búsqueda/historial requieren las RPC pendientes. |
| 14–16 · adaptación, foco y movimiento | Corregidos y comprobados en los tamaños revisados. |
| 18 · contraste | Sin fallos en las muestras de panel y seguimiento, claro y oscuro. |
| 19 · documentación | Actualizados DESIGN.md, sidecar, PRODUCT.md y README.md. |
| 20 · cobertura | Suite ampliada a 35 pruebas de navegador y 15 SQL locales. |
