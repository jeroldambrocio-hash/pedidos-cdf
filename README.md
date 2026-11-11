# Pedidos CDF

Gestión de pedidos de flores (Shopify, TikTok, Instagram, web).

- `index.html` + `js/`: panel. Admin y moderador: calendario, pedidos del día en línea temporal, alta y edición con fotos, búsqueda en todas las fechas, pedidos en riesgo, acciones masivas, archivo, exportación CSV; el admin además ve Estadísticas y Equipo. Florista y repartidor: su agenda con un botón por paso.
  - `js/core.js` datos, estado y carga · `js/icons.js` · `js/photos.js` fotos y subida · `js/sheets.js` editor, diálogos y cambios de estado · `js/orders.js` vista de oficina · `js/agenda.js` florista/repartidor · `js/team.js` · `js/stats.js` · `js/main.js` arranque.
- `seguimiento.html` + `tracking.js`: página pública para el cliente, en `/p/<código>`.
- `i18n.js`: textos ES/EN y preferencias (idioma, tamaño, tema, animaciones). `styles.css`: la única hoja de estilos.
- `config.js`: URL y clave pública de Supabase.

## Backend (Supabase, proyecto `rentrooms`)

Todo lleva el prefijo `cdf_`:
- `cdf_members`: equipo (email, nombre, rol `admin` | `vendor` | `carrier`).
- `cdf_orders`: pedidos. Admin y moderador lo ven todo; la florista, los suyos; el repartidor, los listos sin entregar sin asignar o asignados a él (RLS).
- `cdf_order_events`: historial de cambios de cada pedido (lo escribe un trigger).
- `cdf_notifications`: historial de avisos al cliente y a la florista.
- RPC `cdf_progress`, `cdf_set_bouquet`, `cdf_reschedule`: florista y repartidor cambian el estado por aquí; el servidor comprueba que el paso siga al anterior.
- Buckets privados `cdf-fotos` (captura del pedido, `<id>.jpg`) y `cdf-entregas` (ramo y prueba, `<id>/<aleatorio>.jpg`).
- Edge functions: `cdf-users` (alta/baja del equipo), `cdf-notify` (correos), `cdf-track` (seguimiento público), `cdf-shopify` (importa pedidos nuevos de Shopify).

### Publicar la corrección de integración

012 (archivo/historial), 013 (repartidor/flujo), 014 (precios) y cdf-notify v9 ya están en el servidor, comprobados el 28/10/2026. No repetirlos.

Antes de publicar este cliente, aplicar `20261028012537_secure_prices_and_search.sql`. Conserva copia de los importes, los traslada a `cdf_order_prices` (RLS de administrador), vacía y protege la columna antigua sin borrarla, registra los cambios de precio de forma privada y añade búsqueda sin acentos e historial completo del comprador. También refuerza la comprobación de asignación sobre la fila bloqueada. No elimina pedidos, tablas ni columnas.

La migración debe aprobarse y verificarse antes de publicar el cliente: el buscador y la etiqueta de cliente recurrente usan sus RPC. Revisar `INTEGRATION_STATUS.md` para el estado de esta entrega.

Shopify sigue siendo opcional: requiere desplegar `cdf-shopify`, configurar `SHOPIFY_WEBHOOK_SECRET` y dar de alta el webhook en Shopify. No se activa como efecto secundario de las correcciones.

Estadísticas: fechas de entrega de Manila, archivados incluidos. «A la primera» = entregados sin reintento / entregados, fallidos o con intentos. «Clientes que repiten» = compradores del periodo con más de un pedido en todo su historial hasta hoy. Con precios, el ticket medio usa pedidos con importe conocido. El gráfico de 90 días agrupa por semanas.

### Fase 1 · Anticipo al crear el pedido (pendiente de aprobar y aplicar)

`supabase/migrations/20261111090000_cdf_create_order_with_payment.sql` añade, sin borrar ni renombrar nada:

- `cdf_create_order(p_request, p_order, p_price, p_payment)`: pedido, precio y pago inicial en una sola transacción, solo admin. Si algo falla no queda nada. Repetir la misma petición (doble pulsación, respuesta perdida) devuelve el pedido ya creado; la misma clave con otro contenido da `cdf_operation_conflict`.
- `cdf_operation_keys`: las claves de esas operaciones. Sin acceso desde el cliente.
- `cdf_record_payment` con tres campos más por movimiento: `method`, `reference` y `paid_at` (fecha declarada del pago; `created_at` sigue siendo el momento del registro y `by_email` quién lo registró). La llamada de ocho argumentos del cliente publicado sigue funcionando igual; los movimientos antiguos no cambian.

El cliente detecta la función al cargar. Sin la migración, el alta de pedidos funciona como antes (pedido y precio por separado, pagos después de guardar), así que el cliente puede publicarse antes o después. Con ella, el formulario de pedido nuevo muestra pago inicial, método, fecha, referencia, justificantes y saldo pendiente.

No aplicar con el identificador cambiado si ya consta en producción: comprobar antes `supabase_migrations.schema_migrations`. La migración se detiene sola si falta la de pagos incrementales o si ya está aplicada.

### Fase 2 · Formulario público con mapa y fotos (construido, sin publicar ni enlazar)

- `pedido.html` + `js/public-order.js`: comprador, destinatario, Delivery/Pickup, fecha y franja, dirección y punto en el mapa (buscar, ajustar el pin, confirmar), descripción, fotos de referencia, método preferido y comprobante. Termina en «Solicitud recibida, pendiente de revisión»; no confirma precio, disponibilidad ni pago. No guarda datos personales en el navegador.
- `js/location-picker.js`: el mapa (Leaflet), ahora compartido con el panel.
- `supabase/functions/cdf-public-order/`: función pública separada de Lalamove (no puede cotizar ni reservar). Sesión tras la comprobación antiabuso (Turnstile, validada en servidor), búsqueda de direcciones solo en Filipinas (Google Geocoding con tope diario contado en la base de datos, `PUBLIC_GOOGLE_DAILY`, 150 por defecto; pasado el tope, sin clave o si Google falla, Photon), subida de fotos y validación completa de la solicitud. Las fotos se comprueban por su contenido y se guardan sin EXIF/GPS en el bucket privado `cdf-solicitudes`. **En esta fase una solicitud válida recibe «todavía no abierto»: no se guarda ni se avisa a nadie (eso es la Fase 3).**
- `supabase/migrations/20261111100000_cdf_public_uploads.sql`: sesiones de carga, archivos, límites compartidos y el bucket. Solo añade; ni visitantes ni personal tienen acceso directo.

Tres interruptores, todos apagados: `features.publicOrder` en `config.js`, el secreto `PUBLIC_ORDER=on` de la función y la lista `PUBLIC_ORDER_ORIGINS`. Además `pedido.html` no está en la lista de `scripts/deploy-netlify.sh`. Sin `TURNSTILE_SECRET` la función no abre sesiones.

Pendiente antes de abrirlo: claves de Turnstile, franjas y métodos de pago definitivos, proveedor de búsqueda (el servidor público de Photon no garantiza servicio) y la limpieza periódica de cargas abandonadas.

## Probar en local

Necesitas un servidor local, porque las rutas empiezan por `/`:

```bash
npx serve .
```

`serve.json` hace que `/p/<código>` funcione también en local. Ojo: en local te conectas a la misma base de datos que la web publicada.

### Pruebas automáticas (sin tocar la base de datos)

```bash
npm i --prefix .test-tools playwright
```

```bash
NODE_PATH=.test-tools/node_modules node tests/ui-smoke.cjs
```

Usan un Supabase falso dentro del navegador y Google Chrome. Las capturas quedan en `.impeccable/review/`.

Base de datos (PostgreSQL temporal, nunca Supabase):

```bash
npm i --prefix .test-tools @electric-sql/pglite embedded-postgres pg
NODE_PATH=.test-tools/node_modules node tests/create-order-db.cjs           # reglas, permisos, idempotencia, rollback
NODE_PATH=.test-tools/node_modules node tests/create-order-concurrency.cjs  # varias sesiones a la vez, en un PostgreSQL local real
```

Formulario público (función real + SQL real en memoria; solo se simulan Turnstile, el buscador y el almacén de archivos):

```bash
NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/public-order.test.mjs   # imágenes, validación, función, permisos
NODE_PATH=.test-tools/node_modules node --experimental-strip-types tests/public-order-ui.mjs     # el formulario en el navegador, móvil y escritorio
node tests/build-form-demo.cjs demo-formulario.html                                              # el formulario en un solo HTML, sin servidor
```

Demo con datos ficticios, sin servidor: `node tests/build-demo.cjs .test-tools/demo --single demo.html` genera un único HTML que se abre con doble clic (no puede conectar con Supabase: no lleva ni la dirección ni la clave).

## Publicar

Es un sitio estático sin build. Netlify publica la raíz del repo (`netlify.toml`), y `_redirects` envía `/p/*` a `seguimiento.html`.

Netlify no publica solo al subir a GitHub: se publica con `bash scripts/deploy-netlify.sh` (CLI de Netlify con sesión iniciada).
Copia únicamente los archivos web del último commit y escribe `version.json`. La app abierta lo consulta cada 5 minutos y al volver
a la pestaña; si cambia, avisa ("Hay una versión nueva…") y se recarga sola en cuanto no hay ninguna ventana abierta ni campo a medio escribir.


### Comprobar permisos y migraciones sin producción

```bash
npm i --prefix .test-tools @electric-sql/pglite@0.5.12
NODE_PATH=.test-tools/node_modules node tests/db-regression.cjs
```

Ejecuta PostgreSQL temporal con pedidos ficticios. Comprueba conservación de importes, permisos por rol, historial privado, búsqueda con acentos y flujo de reparto. No se conecta al proyecto real. Los resultados se guardan en `.impeccable/review/sql-verification.json`.

### Acceso por usuario o correo

El formulario acepta correo + contraseña como siempre, o un usuario único + la misma contraseña.
El admin asigna o cambia el usuario en **Equipo → Editar**; también puede indicarlo al añadir una cuenta.
Es opcional: las cuentas existentes siguen entrando por correo hasta que se les asigne uno.
Formato: 3–30 caracteres, primera letra o número, después letras ASCII, números, `.`, `_` o `-`.
Se guarda en minúsculas; el nombre visible y el rol no cambian. El usuario aparece en Mi cuenta.

Orden de publicación: aplicar `20261104120449_cdf_username_login.sql`, desplegar `cdf-login`
con `verify_jwt=false` (autentica la contraseña dentro de la función) y actualizar `cdf-users`;
después publicar el cliente. `cdf-login` devuelve tokens solo tras validar la contraseña;
no existe una consulta pública que devuelva el correo de un usuario. Su cuota compartida
limita a diez intentos por usuario cada cinco minutos, sin guardar contraseñas ni correos.
Las tablas y RPC de cuota solo son accesibles con `service_role`.

Verificación aislada:

```bash
node tests/username-login.cjs
NODE_PATH=.test-tools/node_modules node tests/username-db.cjs
```

La segunda prueba usa `@electric-sql/pglite@0.5.12`. La primera requiere Node 24 y simula
el proveedor de autenticación; ninguna utiliza cuentas reales ni se conecta a producción.

## Correo de los avisos (cdf-notify)

La función envía con el primer proveedor que tenga sus secretos puestos en Supabase (Edge Functions → Secrets):

1. **Buzón propio por SMTP** (Hostinger): `SMTP_USER` (el correo, p. ej. pedidos@tudominio.com), `SMTP_PASS` (su contraseña).
   Opcionales: `SMTP_HOST` (por defecto `smtp.hostinger.com`), `SMTP_PORT` (por defecto `465`), `SMTP_FROM_NAME` (por defecto "Casa de Flores").
2. **Gmail**: `GMAIL_USER` y `GMAIL_APP_PASSWORD` (contraseña de aplicación de Google).
3. **Resend**: `RESEND_API_KEY` (y `CDF_MAIL_FROM`).

Supabase bloquea los puertos 25 y 587, así que el SMTP tiene que ir por el 465 (SSL).
En el historial de avisos de cada pedido se ve por cuál salió cada correo (`smtp:`, `gmail:` o `resend:`).

### Correo al cliente (diseño)

La plantilla está en `supabase/functions/cdf-notify/email.ts` (HTML con tablas y estilos en línea, más versión en texto plano).
El texto se adapta al estado del pedido cuando sale el correo; la foto del ramo va con un enlace firmado de 30 días y,
si no hay foto, ese bloque no aparece. Para verlo sin enviar nada: `node tests/demo.cjs` y abrir http://localhost:4324/email.
Comprobaciones: `NODE_PATH=.test-tools/node_modules node tests/email-check.cjs` (capturas en `.impeccable/review/email-*.png`).

## Funciones apagadas (8/11/2026)

El seguimiento del cliente y las cuentas de repartidor están apagados, no borrados. Para volver a activarlos:

- **Seguimiento**: `tracking: true` en `config.js` (enlace en el pedido, mensajes de WhatsApp y página `/p/…`)
  y el secreto `CDF_TRACKING=on` en Supabase (botón «View my order» de los correos y la función `cdf-track`).
- **Repartidores**: `drivers: true` en `config.js` (rol, campo Repartidor y acceso de sus cuentas)
  y el secreto `CDF_DRIVERS=on` en Supabase (crear cuentas de repartidor desde `cdf-users`).

Las cuentas de repartidor y los pedidos asignados no se borran. Pruebas: `tests/features-off.cjs` (apagado)
y `tests/ui-smoke.cjs` (todo encendido).
## Lalamove (en pruebas)

En el editor de un pedido, el admin ve un bloque **Lalamove**: busca el punto de entrega (o pega un enlace de Google Maps),
ve el precio, reserva un rider, sigue su estado y su nombre/matrícula, y cancela mientras Lalamove lo permita.
Floristas y repartidores no lo ven. Rama `lalamove-sandbox`; no está publicado.

Piezas:
- `supabase/migrations/029_cdf_lalamove.sql`: tabla `cdf_lalamove` (solo lectura para admin; escribe solo la función). Solo añade.
- `supabase/functions/cdf-lalamove`: cotizar, reservar, consultar, cancelar y webhook. Desplegar con `--no-verify-jwt`.
- `js/lalamove.js`: el bloque del editor. Si no hay migración o función, no aparece nada.

Secretos de la función (Edge Functions → Secrets):
- `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET`: del Partner Portal de Lalamove (pestaña Sandbox).
- `LALAMOVE_ENV`: `sandbox` (por defecto) o `production`.
- `GOOGLE_MAPS_KEY` (opcional): clave de Google Maps restringida a **Geocoding API**. Con ella el buscador de direcciones usa
  Google (encuentra números de casa y urbanizaciones de Filipinas); sin ella, o si Google falla o se alcanza la cuota, busca
  en OpenStreetMap (Photon) como antes. Google da 10.000 búsquedas gratis al mes; poner en su consola un tope de 300 al día.
- `LALAMOVE_PICKUP`: `{"lat":14.65,"lng":121.04,"address":"…","name":"Casa de Flores","phone":"+63…"}` (la tienda).
- `LALAMOVE_WEBHOOK_TOKEN`: texto largo aleatorio. Webhook en el Partner Portal:
  `https://<proyecto>.supabase.co/functions/v1/cdf-lalamove?token=<ese texto>`.
- `LALAMOVE_SYNC_ORDERS`: en producción el pedido sigue al rider (recogido → «En camino», completado → «Entregado»);
  ponerlo a `off` lo desactiva. En sandbox nunca toca los pedidos, porque los riders de prueba no son reales.
- El webhook se registra solo: `POST …/functions/v1/cdf-lalamove?token=<LALAMOVE_WEBHOOK_TOKEN>&register=1`
  (hay que repetirlo al cambiar de claves sandbox → producción).

Pruebas (sin red ni producción):

```bash
node --experimental-strip-types tests/lalamove.test.mjs
NODE_PATH=.test-tools/node_modules node tests/lalamove-db.cjs
NODE_PATH=.test-tools/node_modules node tests/lalamove-ui.cjs
```

### Pagos incrementales

Antes de publicar el cliente, aplica `20261109120000_cdf_incremental_payments.sql` después de `037_cdf_payments_rider_alerts.sql`. En una instalación desde cero, aplica `20261028012537_secure_prices_and_search.sql` antes de la 037, ya que esta depende de la tabla privada de precios. Conserva los identificadores de migración en los entornos existentes.

La migración conserva el total pagado y los comprobantes previos como saldo de apertura. Los pagos nuevos guardan importe, usuario, fecha y comprobantes privados. Para corregir un pago, anúlalo con un motivo y registra el importe correcto. La anulación queda en el historial.

Vista previa con datos ficticios: `node tests/demo.cjs` y abre http://localhost:4324/?role=admin. Abre el pedido 0124, con ₱2.000 ya pagados y ₱500 pendientes.

## Notificaciones siempre activas y calendario de floristas (10/11/2026)

- **Notificaciones**: el permiso del navegador es por dispositivo, así que cada uno (PC, móvil) se activa una vez. A partir de ahí la app
  lo mantiene sola: al abrirla vuelve a enlazar el dispositivo con quien ha entrado, crea de nuevo la suscripción si el teléfono la perdió
  o si se cerró sesión, y reintenta al recuperar la conexión. Solo se queda apagado si la persona pulsa «Desactivar» en ese dispositivo.
  Si falta la migración `028_cdf_push_lang.sql` (columna `lang`), el dispositivo se guarda igualmente y sus avisos llegan en inglés.
- **Floristas**: ven el calendario junto a su lista. Los días con pedidos suyos van marcados; al elegir un día ven lo que tienen asignado
  (cualquier mes), y «Hoy» devuelve la lista habitual. No ven filtros, herramientas de oficina ni pedidos de otras floristas (RLS).

Pruebas: `NODE_PATH=.test-tools/node_modules node tests/notif-calendar.cjs`.

## Pin en el mapa y canal obligatorio (11/11/2026)

- **Pin a mano**: «Marcar en el mapa» abre un mapa (Leaflet + OpenStreetMap, gratis y sin clave; la librería va en `js/vendor/`)
  para arrastrar el pin hasta la puerta cuando el buscador no encuentra la dirección. Está en el pedido (junto a «Buscar en el mapa»),
  en el bloque de Lalamove («Marcar en el mapa» y «Ajustar el pin en el mapa») y en Equipo → editar (tienda de la florista).
  El rider recibe siempre la dirección escrita del pedido además del punto.
- El punto elegido en el bloque de Lalamove se guarda también en el pedido (la reserva exige que coincidan). Solo un admin puede
  cambiarlo; una florista con un pedido que ya tiene punto debe pedir la corrección a la oficina.
- **Canal obligatorio**: no se guarda un pedido (nuevo o editado) sin canal: Shopify, Instagram, TikTok o Web.

Pruebas: `node tests/map-channel.cjs`.

