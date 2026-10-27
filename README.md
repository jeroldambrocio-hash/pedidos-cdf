# Pedidos CDF

Gestión de pedidos de flores (Shopify, TikTok, Instagram, web).

- `index.html` + `js/`: panel. Admin y moderador: calendario, pedidos del día en línea temporal, alta y edición con fotos, búsqueda en todas las fechas, pedidos en riesgo, acciones masivas, archivo, exportación CSV; el admin además ve Estadísticas y Equipo. Florista y repartidor: su agenda con un botón por paso.
  - `js/core.js` datos, estado y carga · `js/icons.js` · `js/photos.js` fotos y subida · `js/sheets.js` editor, diálogos y cambios de estado · `js/orders.js` vista de oficina · `js/agenda.js` florista/repartidor · `js/team.js` · `js/stats.js` · `js/main.js` arranque.
- `seguimiento.html` + `tracking.js`: página pública para el cliente, en `/p/<código>`.
- `i18n.js`: textos ES/EN y preferencias (idioma, tamaño, tema, animaciones). `styles.css`: la única hoja de estilos.
- `config.js`: URL y clave pública de Supabase.

## Backend (Supabase, proyecto `rentrooms`)

Todo lleva el prefijo `cdf_`:
- `cdf_members`: equipo (email, nombre, rol `admin` | `moderator` | `vendor` | `carrier`).
- `cdf_orders`: pedidos. Admin y moderador lo ven todo; la florista, los suyos; el repartidor, los listos sin entregar sin asignar o asignados a él (RLS).
- `cdf_order_events`: historial de cambios de cada pedido (lo escribe un trigger).
- `cdf_notifications`: historial de avisos al cliente y a la florista.
- RPC `cdf_progress`, `cdf_set_bouquet`, `cdf_reschedule`: florista y repartidor cambian el estado por aquí; el servidor comprueba que el paso siga al anterior.
- Buckets privados `cdf-fotos` (captura del pedido, `<id>.jpg`) y `cdf-entregas` (ramo y prueba, `<id>/<aleatorio>.jpg`).
- Edge functions: `cdf-users` (alta/baja del equipo), `cdf-notify` (correos), `cdf-track` (seguimiento público), `cdf-shopify` (importa pedidos nuevos de Shopify).

### Pasar esta versión a producción (en este orden, cuando se autorice)

1. Migraciones `supabase/migrations/012_cdf_archive_history.sql` y luego `013_cdf_carrier_rules.sql`.
2. Volver a desplegar `cdf-notify` (ahora solo admin/moderador pueden enviar correos de texto libre).
3. Opcional, Shopify: desplegar `cdf-shopify` con `--no-verify-jwt`, guardar el secreto `SHOPIFY_WEBHOOK_SECRET` y crear en Shopify el webhook "Order creation" apuntando a `https://<proyecto>.supabase.co/functions/v1/cdf-shopify`.
4. Publicar el sitio en Netlify.

El panel nuevo también funciona sin las migraciones 012/013 (sin archivo, sin historial de cambios y sin repartidor asignado), así que el orden protege pero no rompe.

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

## Publicar

Es un sitio estático sin build. Netlify publica la raíz del repo (`netlify.toml`), y `_redirects` envía `/p/*` a `seguimiento.html`.
