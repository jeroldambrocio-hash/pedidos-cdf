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

### Publicar la corrección de integración

012 (archivo/historial), 013 (repartidor/flujo), 014 (precios) y cdf-notify v9 ya están en el servidor, comprobados el 28/10/2026. No repetirlos.

Antes de publicar este cliente, aplicar `20261028012537_secure_prices_and_search.sql`. Conserva copia de los importes, los traslada a `cdf_order_prices` (RLS de administrador), vacía y protege la columna antigua sin borrarla, registra los cambios de precio de forma privada y añade búsqueda sin acentos e historial completo del comprador. También refuerza la comprobación de asignación sobre la fila bloqueada. No elimina pedidos, tablas ni columnas.

La migración debe aprobarse y verificarse antes de publicar el cliente: el buscador y la etiqueta de cliente recurrente usan sus RPC. Revisar `INTEGRATION_STATUS.md` para el estado de esta entrega.

Shopify sigue siendo opcional: requiere desplegar `cdf-shopify`, configurar `SHOPIFY_WEBHOOK_SECRET` y dar de alta el webhook en Shopify. No se activa como efecto secundario de las correcciones.

Estadísticas: fechas de entrega de Manila, archivados incluidos. «A la primera» = entregados sin reintento / entregados, fallidos o con intentos. «Clientes que repiten» = compradores del periodo con más de un pedido en todo su historial hasta hoy. Con precios, el ticket medio usa pedidos con importe conocido. El gráfico de 90 días agrupa por semanas.

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


### Comprobar permisos y migraciones sin producción

```bash
npm i --prefix .test-tools @electric-sql/pglite@0.5.12
NODE_PATH=.test-tools/node_modules node tests/db-regression.cjs
```

Ejecuta PostgreSQL temporal con pedidos ficticios. Comprueba conservación de importes, permisos por rol, historial privado, búsqueda con acentos y flujo de reparto. No se conecta al proyecto real. Los resultados se guardan en `.impeccable/review/sql-verification.json`.
