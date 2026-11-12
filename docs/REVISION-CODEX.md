# Revisión de Codex (12/11/2026): contraste y correcciones

Nada de esto está aplicado en producción ni publicado. Todo está en la rama `claude/revision-codex`, pendiente de tu revisión.

## Los cuatro puntos

| # | Lo que dijo Codex | ¿Es cierto? | Corrección |
|---|---|---|---|
| 1 | Al reintentar un pedido nuevo tras perder la respuesta, se borran los comprobantes aunque el primer intento sí se guardó | **Sí.** Se perdía la respuesta, cambiabas un dato y volvías a guardar: el servidor decía «ya guardado» y el panel borraba el comprobante que ese pago usaba. Lo reproduje con una prueba. | Antes de borrar, el panel lee el pago guardado y solo borra los archivos que no usa. Si no puede leerlo, no borra nada. |
| 2 | Un envío completado con fila de prueba «no proporcionada» ya no se vuelve a consultar, así que una foto que llegue después se pierde | **Sí.** Además había otro fallo: la ventana de «2 días» se medía con un campo que cada consulta renueva, así que nunca se cerraba. | Un envío entregado sin foto se vuelve a consultar cada 30 minutos durante 3 días desde la reserva, hasta que haya foto guardada. Si Lalamove marca la entrega como fallida, se deja de consultar. |
| 3 | Se acepta un PNG con estructura y CRC correctos pero datos de imagen inválidos | **Sí.** Solo se comprobaba la estructura del archivo. | El servidor solo acepta JPEG, que es lo único que envía el formulario (reduce cada foto en el navegador). Ese JPEG se descodifica completo y de forma estricta, con límites de tamaño y memoria, y su tamaño debe coincidir con la cabecera. PNG y WebP se rechazan. Tamaño máximo: de 8000 a 4096 px por lado. |
| 4 | La caducidad y limpieza está en `main` pero no en producción, y la función desplegada no tiene la limpieza | **Sí.** Comprobado en producción, solo lectura. | Queda preparada para aplicarla en el orden de abajo. |

## Segunda revisión independiente (12/11/2026, commit `1fa4487`)

| Hallazgo | ¿Es cierto? | Corrección |
|---|---|---|
| El control antibots puede dejar el formulario bloqueado si el script de Cloudflare no termina de descargarse: el plazo de 45 s solo empezaba al cargar el script | **Sí.** Con la descarga colgada, el botón se quedaba en «Sending…» para siempre. | El plazo de 45 s cubre ahora todo, también la descarga. Al vencer, se limpia el script colgado y el recuadro, el formulario lo dice y el botón vuelve a funcionar. Pulsar otra vez empieza una descarga nueva. La promesa se resuelve una sola vez. Prueba: descarga que no termina y reloj adelantado 46 s. |
| La validación PNG aún aceptaba PNG no descodificables (indexado sin paleta) | **Sí.** Descomprimir y comprobar los filtros no es descodificar. | Se rechazan todos los PNG en el servidor (ver punto 3), porque el formulario nunca los envía. Regresión: PNG indexado sin paleta, PNG con datos basura, PNG correcto y la muestra existente, todos rechazados; los dos JPEG de muestra (normal y progresivo) aceptados. |

## Encontrado además en las pruebas en vivo

- **El formulario dice «No pudimos comprobar que eres una persona»** (tu captura). Tu intento ni siquiera llegó al servidor: falló en el navegador. Cloudflare devuelve a veces un error pasajero (600010), que normalmente se resuelve reintentando. El formulario se rendía al primer error y además borraba el recuadro, así que Cloudflare no podía reintentar.
  - **Corrección:** se deja que Cloudflare reintente y solo se da por fallido tras 3 errores o 45 segundos.
  - Si hace falta que la persona pulse algo, el recuadro aparece abajo, visible.
  - Probado con un Cloudflare simulado: «falla 2 veces y pasa» envía la solicitud; «falla siempre» muestra el aviso.

## Pruebas nuevas (todas fallaban con el código anterior y pasan con el nuevo)

- Panel: pedido con comprobante, respuesta perdida, cambio y nuevo guardado → el comprobante del pago guardado no se borra.
- Lalamove: entregado sin foto → foto añadida más tarde sin aviso de Lalamove → se guarda. Entrega fallida y envíos antiguos → no se consultan.
- Imágenes:
  - Cualquier PNG (incluido el indexado sin paleta y el que tiene datos basura) → rechazado.
  - JPEG cortado, o con los datos de imagen sobrescritos → rechazado.
  - WebP → rechazado.
- Formulario: el control antibots se reintenta y, si sigue fallando, muestra el aviso. Si el script de Cloudflare no llega a descargarse, el formulario se recupera a los 45 s.

Todas las demás pruebas siguen en verde: panel 73, formulario 23 en el navegador y 16 en el servidor, Lalamove 24, solicitudes, paridad con producción y vuelta atrás.

## Para poner producción al día (cuando lo apruebes, en este orden)

1. **Desplegar `cdf-public-order`:** limpieza diaria y descodificación de imágenes.
2. **Desplegar `cdf-push`:** aviso «solicitud caducada».
3. **Aplicar la migración `20261112090000_cdf_request_expiry`:** caducidad, borrado y tarea diaria a las 00:05 de Manila.
4. **Aplicar la migración `20261112100000_cdf_lalamove_reconcile_fix`:** el punto 2.
5. **Publicar en Netlify:** el arreglo del control antibots y la corrección del punto 1, junto con las PR #15 (enlace del formulario) y #16 (correo repetido) si las apruebas. La #16 también despliega `cdf-users`.

Después compruebo que la tarea diaria existe, que la limpieza responde y que el formulario pasa el control antibots.

## Política de retención que necesita tu aprobación expresa

Con el paso 3, todo esto pasa a ser automático:

| Qué | Cuándo | Qué se borra |
|---|---|---|
| Solicitud **sin responder** cuyo día de entrega ya pasó | A las 00:05 de Manila del día siguiente | Nada: pasa a «Caducada» y llega un aviso al móvil de los admins, sin datos del cliente |
| Solicitud **rechazada** o **caducada** | 90 días después de cerrarse | La solicitud, su historial, sus fotos y su comprobante de pago |
| Fotos de un formulario **que no se llegó a enviar** | 1 día después de que caduque la sesión (2 h) | Las fotos y la sesión |
| Solicitud **aceptada** | Nunca | Nada: ya es un pedido. Sus fotos de referencia y su comprobante se quedan con él |

Dos cosas que conviene que decidas tú:
- **¿90 días te parece bien para las rechazadas y caducadas?** Ya lo dijiste en el chat, pero conviene confirmarlo ahora que está escrito.
- **¿El comprobante de pago de una solicitud aceptada se guarda para siempre?** Ahora sí, igual que los comprobantes de los pedidos.

## Tercera revisión (PR #18, Estadísticas) — 12/11/2026

1. **Dar Estadísticas al crear o ascender un admin.** Confirmado. El trigger ahora también vigila altas, cambios de rol y bajas. Si quien crea o asciende a un admin no tiene Estadísticas, el nuevo admin empieza sin ellas. Un admin sin Estadísticas no puede degradar a uno que las tiene. La función `cdf-users` (que escribe con la identidad de servicio) aplica la misma regla en `stats.ts`: da de alta sin Estadísticas y no deja quitar a un admin que las tiene.
2. **Dos admins se quitan el acceso a la vez.** Confirmado. Los cambios que dan o quitan Estadísticas esperan su turno (un bloqueo de transacción) y siempre queda al menos un admin con acceso: quitar, degradar o borrar al último se rechaza (`cdf_stats_last`), también desde la propia base de datos.

Pruebas: `stats-access-db.cjs` (9, cuatro nuevas), `stats-access-concurrency.cjs` (PostgreSQL real, 3 carreras), `cdf-users-stats.test.mjs` (3). Con la migración anterior, la prueba de altas y la de concurrencia fallan.

Alcance: ocultar Estadísticas no oculta los precios de cada pedido; no es una barrera de confidencialidad de los datos financieros.

Orden de publicación: `cdf-users` lee la fila completa (`select("*")`), así que funciona antes y después de la migración.

## Política de retención — aprobada por Jerold el 12/11/2026

- Solicitud sin respuesta: pasa a «Caducada» el día después de su fecha de entrega y el equipo recibe un aviso.
- Rechazadas o caducadas: se borran a los 90 días.
- Fotos de formularios que no se llegaron a enviar: se borran al día siguiente.
- Aceptadas (con su comprobante de pago): no se borran nunca.

## Revisión final de integración — 12/11/2026

1. **Limpieza de fotos contra reabrir una solicitud (alta).** Confirmado. La limpieza ahora primero *reserva* lo que va a borrar (`purge_claimed_at` en solicitudes y fotos, `cdf_requests_purge_claim`). Una solicitud reservada ya no se puede reabrir ni aceptar (responde «cerrada»), y una foto reservada no se puede unir a una solicitud. Si el almacenamiento falla, la reserva se queda y la siguiente vuelta termina el trabajo; solo se borran filas reservadas. Si la reapertura llega antes, la solicitud no se reserva y conserva sus fotos.
   Pruebas: `request-expiry.test.mjs` (intercalado en los dos órdenes y fallo de almacenamiento) y `request-purge-concurrency.cjs` (PostgreSQL real, dos sesiones a la vez).
2. **Un fallo temporal de push se daba por terminado (media).** Confirmado. `cdf-push/send.ts` confirma un aviso de la cola solo cuando cada dispositivo lo recibió o ya no existe (404/410, se olvida). Un 503, un fallo de red, un error al buscar dispositivos o la solicitud, o un fallo al confirmar lo dejan pendiente y la cola lo reintenta. Los dispositivos que ya lo recibieron se apuntan (`cdf_outbox.sent_endpoints`, migración `20261112120000_cdf_outbox_sent_devices`) y no lo reciben dos veces. Los avisos que no vienen de la cola (chat) se envían igual que antes.
   Pruebas: `push-send.test.mjs` (503, red, entrega parcial y reintento, 404/410, búsquedas fallidas, confirmación fallida, columna real en base de datos).

Compatibilidad de despliegue: `cdf-push` funciona antes y después de la migración nueva (si falta la columna, no recuerda dispositivos). La limpieza automática se programa al aplicar `20261112090000`, que requiere autorización.
