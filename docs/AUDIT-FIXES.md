# Correcciones de la auditoría CDF — preparadas, sin publicar

13/11/2026. Copia aislada de los archivos locales de `C:\Users\jerol\pedidos-cdf`.
La referencia main leída al copiar era `2b7ad788e486b8c2a99df68b63fd290839287f46`.
No se ha escrito en esa carpeta, subido a GitHub, modificado Supabase ni publicado en Netlify.
Esta copia tiene su propio historial Git de revisión; no es un worktree del repositorio original.

## Cambios

- **E01, Lalamove:** nueva `syncDelivery`, con errores de lectura/escritura explícitos y hasta tres intentos ante conflictos. Compara `updated_at` y relee el pedido, respetando cancelaciones concurrentes. Sincroniza antes de persistir el estado final del rider: si falla, el envío sigue pendiente para la reconciliación existente.
- **E02, solicitudes:** comprueba errores de fotos, coincidencias, historial y estado del pedido aceptado. La revisión incompleta no se abre; muestra aviso con reintento. Los bloques de referencias muestran el fallo y permiten recuperarlo. Conserva protección por sesión.
- **E03, push:** el registro automático informa del fallo, conserva un código de diagnóstico sin datos personales y ofrece reintento. El estado se limpia tras recuperar el registro. Las operaciones de una sesión anterior no cambian el diagnóstico de otra cuenta.
- **E04, refrescos:** una vuelta breve con realtime conectado conserva la lista; tras suspensión de más de un minuto o desconexión se recuperan datos. El temporizador ya no recarga listas cuando realtime funciona. La deduplicación de cargas ocurre antes de invalidar estadísticas.
- **E05, estadísticas:** gastos de riders filtrados por IDs del periodo, en grupos de 200 y con paginación completa. Los errores se muestran con reintento.
- **E06, email:** handler preparado para confirmar la outbox solo tras éxito u obsolescencia. Fallos de envío/consulta/confirmación permanecen pendientes. Las asignaciones antiguas no se envían a una florista si el pedido ha cambiado de asignación.
- **E07, acceso:** landmark principal visible para lectores de pantalla.
- **S01:** propuesta SQL para retirar TRUNCATE a roles de cliente solo en tablas CDF.

## Base de datos: cambio pendiente

`docs/audit-durable-email.sql` es una propuesta revisable, no una migración aplicada.
Reutiliza la outbox privada, el dispatcher y el cron existentes para futuros emails automáticos.
No reenvía avisos históricos. La política es entrega al menos una vez: un fallo después de SMTP y antes de confirmar en base de datos todavía puede duplicar un correo. No se promete exactamente una vez.

La CLI Supabase no está instalada/disponible en este entorno; la ejecución offline confirmó que no existe en la caché. Cuando esté disponible, ejecutar `supabase migration new cdf_audit_durable_email`, incorporar este SQL y verificarlo primero en staging. No renombrar ni reutilizar una migración antigua.

Orden propuesto: revisar y probar en staging; desplegar cdf-notify compatible; aplicar la nueva migración; desplegar cdf-lalamove y el frontend. Repetir las lecturas de catálogos/permisos y pruebas con cuentas de staging. Publicar únicamente tras aprobación del resultado.

## Validación realizada

- Sintaxis de los cuatro JS modificados y los entrypoints TypeScript de las Edge Functions.
- `lalamove.test.mjs`: firmas, coordenadas, teléfonos y transiciones.
- `lalamove-sync.test.mjs`: escritura correcta, errores de lectura/escritura, reintento de conflicto, límite de intentos y cancelación concurrente.
- `lalamove-events.test.mjs`: webhook, colas, reintentos, POD/POP, descargas y permisos sobre SQL en PGlite.
- `lalamove-booking.test.mjs`: reserva concurrente, respuestas perdidas y recuperación, usando la base desechable.
- `push-send.test.mjs`: reintentos, confirmación y deduplicación por dispositivo.
- `email-durable.test.mjs`: aplica el SQL propuesto a una base PostgreSQL desechable construida desde las migraciones; comprueba triggers, routing a email, reintentos y retirada de TRUNCATE. También prueba confirmación y fallos del helper del handler.
- `session-switch-ui.cjs`: respuestas tardías tras cambio de cuenta.
- `requests-ui.cjs`: listado, revisión, aceptación, concurrencia, respuesta perdida, notificaciones y móvil ES.
- `notif-calendar.cjs`: registro push, lang, cambio de cuenta, desactivación voluntaria, calendario florist y móvil.
- `audit-failures-ui.cjs`: errores visibles, recuperación, foreground saludable/desconectado y gasto completo con 1005 riders y límite simulado de 37 filas por respuesta.
- `git diff --check` sin errores.

Las pruebas de navegador usaron Chrome con el mock existente y el adaptador `tests/local-network-routing.cjs`, porque el entorno bloquea las conexiones loopback y la carga real del service worker local. El adaptador entrega los mismos archivos desde disco y proporciona registro de service worker ficticio. Esto NO sustituye las pruebas de notificaciones reales en iPhone/Android ni la validación de RLS con sesiones reales.

Las primeras ejecuciones revelaron un dato obligatorio ausente en el fixture de email y límites del transporte local del navegador; se corrigieron los fixtures/adaptador y se repitieron las pruebas afectadas.

## Previsualización y límites

`docs/audit-preview.html` es una demo autocontenida generada con datos ficticios. Se ha abierto en Chrome y comprobado que muestra el panel. No valida las Edge Functions ni escribe en la base real. La demo tiene un diseño anterior en sus etiquetas de presentación; su finalidad aquí es revisar el funcionamiento del cliente, no demostrar paridad visual/operativa de producción.

Pendiente: pruebas reales de cuentas admin/florist/driver en staging, envío push en dispositivos reales y recuperación frente a fallos reales de Lalamove/SMTP. Los cambios del servidor y SQL siguen sin aplicarse. No se ha activado Driver, tracking ni protección de contraseñas filtradas; no se ha cambiado la definición comercial de las métricas.

El parche incluye únicamente los cambios respecto a la copia local inicial. Debe revisarse al incorporarlo al repositorio original, ya que puede haber trabajo posterior de otros agentes.
