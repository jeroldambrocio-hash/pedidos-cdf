# Pedidos CDF

Gestión de pedidos de flores (Shopify, TikTok, Instagram, web).

- `index.html` + `app.js`: panel de admin (calendario, pedidos del día, alta/edición con foto, equipo) y portal de vendedor (solo sus pedidos).
- `seguimiento.html`: página pública para el cliente, en `/p/<código>`.
- `config.js`: URL y clave pública de Supabase.

## Backend (Supabase, proyecto `rentrooms`)

Todo lleva el prefijo `cdf_`:
- `cdf_members`: equipo (email, nombre, rol `admin` | `vendor`).
- `cdf_orders`: pedidos. Los admins lo ven todo y los vendedores solo los suyos (RLS).
- `cdf_track(code)`: función pública que solo devuelve número, fecha, franja y estado.
- Bucket privado `cdf-fotos`: las fotos se guardan como `<id del pedido>.jpg`.
- Edge function `cdf-users`: los admins añaden o quitan personas del equipo.

## Publicar

Es un sitio estático sin build. Netlify publica la raíz del repo (`netlify.toml`), y `_redirects` envía `/p/*` a `seguimiento.html`.
