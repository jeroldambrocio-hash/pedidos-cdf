# Fase 6 · Evidencias, migraciones y despliegue (para aprobar)

11/11/2026. Nada de esto se ha aplicado: ni migraciones en Supabase, ni funciones, ni Netlify, ni `main`.
Producción se ha leído **solo en lectura** (catálogo, migraciones, funciones y logs), con tu autorización.

## 0. Estado del despliegue (11/11/2026, 20:00 hora de España)

Aprobado y hecho:
- **GitHub**: PR #5 → #10 fusionadas en `main` (`ed7ff40`).
- **Supabase, migraciones aplicadas en orden**: `20261111185306 cdf_create_order_with_payment`, `20261111185334 cdf_public_uploads`, `20261111185436 cdf_order_requests`, `20261111185458 cdf_branch_ranking` y `20261111185605 cdf_lalamove_events`.
  - Producción coincide con lo esperado: 23 tablas, 6 buckets, 9 tablas en tiempo real y 21 disparadores.
  - Las 40 funciones nuevas o cambiadas son **idénticas byte a byte** (md5 del código) a las del repositorio.
- **Funciones desplegadas**: `cdf-lalamove` v16 y `cdf-push` v11, ambas sin `verify_jwt`, como antes.
  - `cdf-lalamove`: se probó la ronda (`cdf_lalamove_work_hook`) y respondió 200. Releyó el envío real y anotó su prueba de entrega.
  - `cdf-push`: arranca y valida la llamada (respuesta 400 `kind` ante un tipo inventado, sin enviar nada).

Pendiente:
- **Netlify**: no se ha publicado, por indicación tuya. La web publicada sigue funcionando: la función de pagos de 8 argumentos se comporta igual.
- **`cdf-public-order`**: no se ha desplegado. Mientras el formulario no se active no hace falta; se desplegará y probará junto con Turnstile.

Primera evidencia real de Lalamove: en el envío `3626117933572534460`, `GET /v3/orders` devuelve en la parada de entrega `POD.status = DELIVERED` y `deliveredAt = 02:43:48 UTC`, **sin enlace de imagen y sin `stopId`**.
- Queda como «No proporcionada». Si Lalamove da después la imagen, se descarga sola.
- Los próximos avisos del webhook se guardarán completos para ver dónde envía la foto.

## 1. Qué hay preparado

| Fase | PR (borrador, apiladas) | Base de datos | Funciones | Web |
|---|---|---|---|---|
| 1 · Anticipo al crear | #5 → `main` | `20261111090000_cdf_create_order_with_payment` | — | editor de pedido |
| 2 · Formulario público | #6 → #5 | `20261111100000_cdf_public_uploads` | `cdf-public-order` (nueva) | `pedido.html` (no se publica aún) |
| 3 · Solicitudes | #7 → #6 | `20261111110000_cdf_order_requests` | `cdf-push` (tipo `request`) | pestaña Solicitudes |
| 4 · Tienda más cercana | #8 → #7 | `20261111120000_cdf_branch_ranking` | — | sugerencia en el editor |
| 5 · Lalamove fiable y pruebas | #9 → #8 | `20261111130000_cdf_lalamove_events` | `cdf-lalamove` | bloque «Pruebas» |
| 6 · Esta verificación | #10 → #9 | — (solo pruebas y un script de vuelta atrás) | `config.toml` completo | script de despliegue |

`main` hoy: `3929679`. Las funciones desplegadas coinciden con `main` (comprobado `cdf-lalamove` v15 byte a byte).

## 2. Evidencias de producción (solo lectura)

**El repositorio reproduce producción exactamente.** `tests/lib/manifest.sql` extrae de una base de datos todo lo que la app expone: tablas y columnas, RLS, políticas, funciones (security definer, `search_path`, quién puede ejecutarlas), permisos de tabla, disparadores, buckets y tablas en tiempo real. En producción da 13 tablas, 44 funciones y 40 políticas (`tests/fixtures/production-manifest-2026-11-11.json`). Las migraciones del repositorio hasta antes de la Fase 1 dan el mismo resultado, sin una sola diferencia.

- La prueba encontró una diferencia que venía del banco de pruebas, no de producción: Supabase da permiso de ejecución por defecto a las funciones nuevas y el banco no lo hacía. Ya está corregido, y todas las suites siguen en verde con el banco más fiel.

**Extensiones y otros datos de producción:**
- Hay `pg_net` y `pgcrypto`. **No hay `pg_cron`**: los reintentos programados de las fases 3 y 5 no se activan solos (ver §5).
- El secreto `cdf_hook_secret` existe en el vault.
- Ningún nombre nuevo choca con nada existente: ni tablas, ni funciones, ni buckets.
- Migraciones registradas: 37, la última `20261110202357 cdf_push_lang`. Los nombres de archivo del repositorio (`001_…`, `038_…`) no coinciden con las versiones de producción, que son marcas de tiempo; el orden real ya está en `tests/lib/fresh-db.cjs`.

**Funciones (`verify_jwt`) en producción:**
- `false`: `cdf-lalamove`, `cdf-login`, `cdf-notify`, `cdf-push`, `cdf-track`.
- `true`: `cdf-users`.
- `supabase/config.toml` ahora las recoge todas, para que un despliegue desde el repositorio no cambie ninguna por accidente. `cdf-public-order` también queda en `false`.
- `cdf-bootstrap-tmp` y `cdf-mailtest-tmp` siguen activas, pero solo responden 410. Se pueden borrar.

**Lalamove real.** Hay un envío en producción: `3626117933572534460`, MOTORCYCLE, reservado a las 02:13:45 UTC y COMPLETED a las 02:44:56.
- Entre las 02:13 y las 02:44 llegaron 9 llamadas al webhook, todas con 200.
- Los cuerpos de esas llamadas no se guardan, así que no hay muestra del contenido de cada evento. Por eso la Fase 5 guarda cada evento tal cual llega y no da por buena ninguna forma no documentada.
- No se ha vuelto a registrar el webhook.

## 3. Hallazgos que necesitan decisión

1. **El token del webhook de Lalamove aparece en los logs de Supabase**, porque va en la URL (`?token=`). Cualquiera con acceso al panel de Supabase lo ve.
   - Propuesta: desplegar la Fase 5 con la firma en modo `observe`. Cuando los eventos reales salgan `valid`, pasar a `LALAMOVE_WEBHOOK_SIGNATURE=enforce`.
   - Después, si quieres, cambiar el token. Eso obliga a registrar la URL nueva en Lalamove (Partner Portal o `PATCH /v3/webhook`), y requiere tu aprobación.
2. **Sin `pg_cron`.** Mientras no esté, los reintentos funcionan así:
   - Fase 3: cada solicitud pública reintenta los avisos pendientes.
   - Fase 5: cada llamada del webhook hace la ronda completa (reintentos, relectura de envíos y descarga de pruebas).
   - Activar `pg_cron` en el proyecto compartido es un cambio de producción aparte. Las migraciones lo programan solas si ya existe.
3. **Host de las fotos de entrega.** La documentación de Lalamove no dice desde qué dominio sirve la foto. Por defecto solo se acepta `lalamove.com` y sus subdominios.
   - Si la primera prueba real llega desde otro dominio, el panel muestra «Origen no admitido: <dominio>» y basta con añadirlo a `LALAMOVE_PROOF_HOSTS`.
4. **La clave de Google Maps del navegador está en `config.js`** (Fases 2–4). Es normal en una clave de navegador y está restringida a tu dominio y a dos APIs, pero queda en GitHub.

## 4. Lo que añaden las fases 1–5 (verificado)

`tests/production-parity.cjs` aplica las cinco migraciones, una a una, sobre la réplica de producción:

- **No cambian ni quitan nada** de lo que producción tiene: tablas, columnas, políticas, permisos de funciones, disparadores, buckets y tiempo real.
- Añaden **10 tablas**, todas con RLS, sin acceso para `anon` y sin escritura desde el navegador: `cdf_operation_keys`, `cdf_upload_sessions`, `cdf_request_files`, `cdf_rate_limits`, `cdf_order_requests`, `cdf_request_events`, `cdf_outbox`, `cdf_lalamove_events`, `cdf_lalamove_shipments` y `cdf_lalamove_proofs`.
- Añaden **39 funciones**, ninguna ejecutable por `anon` y todas con `search_path` vacío.
- Añaden **8 políticas**, **2 buckets privados** (`cdf-solicitudes` y `cdf-lalamove-proofs`) y **4 disparadores**.
- Instalar todo desde cero da exactamente lo mismo que actualizar desde producción.
- Lo que producción debe mostrar después de aplicarlas está en `tests/fixtures/expected-manifest-after-phase5.json`: se ejecuta `tests/lib/manifest.sql` allí y se compara.

## 5. Plan de despliegue (cuando lo apruebes, en este orden)

0. **Copia de seguridad.** Comprobar en Supabase (Database → Backups) que hay una copia reciente.
1. **Fusionar las PR** #5 → #9 en `main` (o #10, que las contiene todas).
2. **Migraciones**, en orden: `…090000` (F1), `…100000` (F2), `…110000` (F3), `…120000` (F4), `…130000` (F5).
   - Después, ejecutar `tests/lib/manifest.sql` en producción y compararlo con `expected-manifest-after-phase5.json`. Deben coincidir.
3. **Funciones**, siempre después de su migración:
   - `cdf-push` (F3).
   - `cdf-lalamove` (F5). **Nunca antes de la migración F5**: sin sus tablas, el webhook respondería 500, Lalamove reintentaría 10 veces y acabaría desactivando la URL.
   - `cdf-public-order` (F2). Queda apagada mientras no exista el secreto `PUBLIC_ORDER=on`.
4. **Web**: `scripts/deploy-netlify.sh`, sin `pedido.html`. El panel comprueba qué existe y no muestra lo que falte.
5. **Comprobaciones tras publicar:**
   - Crear un pedido con anticipo.
   - Abrir la pestaña Solicitudes (vacía).
   - Ver la sugerencia de tienda.
   - En el siguiente envío Lalamove: el evento en `cdf_lalamove_events` con su estado de firma y, al entregarse, la prueba en «Pruebas».
6. **Más adelante**, cada paso por separado:
   - Firma Lalamove en `enforce`.
   - Formulario público: claves de Turnstile, `PUBLIC_ORDER=on`, `PUBLIC_ORDER_ORIGINS`, `PUBLIC_ORDER_SALT`, `features.publicOrder: true` y `PUBLIC_FORM=1 scripts/deploy-netlify.sh`.

**Secretos nuevos.** Ninguno es obligatorio para desplegar:

| Secreto | Fase | Para qué |
|---|---|---|
| `LALAMOVE_WEBHOOK_SIGNATURE` | 5 | `observe` por defecto, `enforce` o `off` |
| `LALAMOVE_PROOF_HOSTS` | 5 | Dominios de los que se aceptan pruebas; por defecto `lalamove.com` |
| `PUBLIC_ORDER` | 2 | Enciende el formulario público |
| `PUBLIC_ORDER_ORIGINS` | 2 | Sitios que pueden llamar al formulario |
| `PUBLIC_ORDER_SALT` | 2 | Para cifrar direcciones IP y de entrega |
| `TURNSTILE_SECRET` | 2 | Comprobación anti-abuso |
| `PUBLIC_GOOGLE_DAILY` | 2 | Opcional; tope diario de búsquedas en Google (150 por defecto) |

## 6. Vuelta atrás

- **Web**: en Netlify (Deploys), publicar el despliegue anterior. Es inmediato.
- **Funciones**: volver a desplegar `cdf-push` y `cdf-lalamove` desde `3929679`, y apagar `cdf-public-order` quitando `PUBLIC_ORDER`.
- **Base de datos**: `supabase/rollback/20261111_phases_1-5_down.sql`. Probado: deja la base de datos exactamente como producción hoy y conserva los pedidos.
  - Borra lo que guardaron las fases nuevas: solicitudes, eventos y filas de pruebas.
  - Los dos buckets nuevos se vacían y se borran a mano desde Storage.
  - Ejecutarlo solo después de volver atrás la web y las funciones.

## 7. Pruebas ejecutadas (todo en local, sin producción)

| Suite | Resultado |
|---|---|
| production-parity (réplica, adiciones, instalación limpia, vuelta atrás) | 5 ok |
| lalamove-events (webhook, firma, reintentos, sustitución, descargas seguras, permisos) | 23 ok |
| lalamove-proofs-ui | 8 ok |
| lalamove.test, lalamove-db, lalamove-ui | 7, 6, 23 ok |
| create-order-db / -concurrency | 18 / 6 ok |
| public-order.test / -ui | 15 / 21 ok |
| requests-db / -concurrency / -ui | 15 / 4 / 12 ok |
| branch-ranking-db, branches-ui | 10, 6 ok |
| fresh-install, db-regression, ui-smoke | 61, 33, 72 ok |

## 8. Lo que no se ha podido verificar

- **Mapa de Google en vivo**: la restricción por dominio impide probarlo fuera de `casadeflores-store.netlify.app`. Lo pruebas tú una vez publicado.
- **Webhook de Lalamove con eventos reales**:
  - la fórmula de la firma;
  - el contenido de `POP_STATUS_CHANGED` (de dónde sale la foto de recogida);
  - un `ORDER_REPLACED` real;
  - el dominio de las fotos.
  - Todo queda guardado tal cual llega desde el primer envío tras desplegar, para confirmarlo.
- **Turnstile real**: necesita las claves del sitio.
