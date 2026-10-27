# Interfaz grafito sobre la versión actual

Base: `origin/main` en `f5ff388`. El formato principal conserva la previsualización aprobada: calendario y filtros laterales, resumen arriba y pedidos en línea temporal con tarjetas. No vuelve al tablero de columnas.

Paleta final elegida por delegación del propietario: fondo gris grafito `#191a1e`, superficie `#24262c`, acción lavanda `#c7c2ff` y tinta cálida `#f4f2ed`. Incluye logos de Shopify, Instagram y TikTok junto al canal; Web usa un globo.

## Integración

- `app.js` conserva los flujos actuales y añade bloqueo por pedido durante un avance de estado.
- `ui.js` adapta la presentación del personal a la línea temporal aprobada y aporta foco de diálogo, iconos, filtros y densidad compacta; delega los cambios a las funciones actuales.
- Orden de estilos: `styles.css`, `reference.css`, `integration.css`.
- `tracking.js` conserva el endpoint `cdf-track` de la versión actual, con fotos mediante URLs temporales, destinatario y mensaje de tarjeta; se extrae del script inline para reutilizar la presentación.
- Se conservan los cuatro roles, comprador y destinatario separados, franja libre, foto real del ramo, prueba de entrega, historial, correo automático al salir y reprogramación. Los mensajes al cliente permanecen en inglés, según el código actual.
- No hay cambios en `supabase/`, migraciones ni políticas. No se ejecuta SQL ni se modifica producción.

## Verificación

Pruebas de navegador con backend simulado: formato/tema, logos, búsqueda de comprador y destinatario entre fechas, filtros, densidad, alta con campos actuales, historial, restricciones visuales del moderador, florista listo/salida mediante `cdf_progress`, repartidor entrega mediante `cdf_progress` y reprogramación mediante `cdf_reschedule`, seguimiento mediante `cdf-track` con fotos temporales, login y escritorio/móvil. Sin errores JavaScript no capturados.

Las pruebas no verifican los correos, las políticas RLS ni la configuración desplegada. No hacen peticiones al backend real. `tests/ui-smoke.cjs` requiere Node.js, Playwright y Google Chrome disponibles en el entorno de pruebas; no añade un build ni dependencias de ejecución a la aplicación.

Se revisaron capturas estables y el revisor independiente puntuó como resueltos sus arreglos de procedencia e iconos. El sistema de diseño se registra en `DESIGN.md` y `.impeccable/design.json`.

Publicación y fusión en `main` pendientes de aprobación del propietario.
