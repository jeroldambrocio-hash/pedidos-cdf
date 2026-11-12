# Despliegue pendiente · 12/11/2026 · recogida, auditoría F01/F02, papelera y tipos

Nada de esto está aplicado en producción. Rama: `papelera-y-tipo-pedido` (incluye las anteriores:
`proof-photo-viewer`, `pago-rapido-y-novedades`, `recogida-en-tienda`, `auditoria-fase1-rider-y-borrado`).

## Orden (todo en la misma ventana: base de datos → funciones → web)

1. Migraciones, en este orden (Supabase → SQL, o `supabase db push`):
   1. `20261112150000_cdf_pickup_orders.sql` — tipo recogida en pedidos, tienda elegida en solicitudes, pasos sin «En camino».
   2. `20261112160000_cdf_ll_booking_guard.sql` — auditoría F01/F02: una reserva Lalamove a la vez, resultado incierto retenido, no borrar con rider.
   3. `20261112170000_cdf_order_trash.sql` — papelera, propietario, registro de borrados, número de pedido en las solicitudes, recuentos.
2. Designar a los propietarios (solo desde el editor SQL; la app no puede hacerlo). Indicados por el dueño el
   12/11/2026: **john.farggi@gmail.com** y **jerold.ambrocio@gmail.com**, y nadie más.
   ```sql
   update public.cdf_members set is_owner = true
   where lower(email) in ('john.farggi@gmail.com', 'jerold.ambrocio@gmail.com') and role = 'admin';
   -- comprobar: deben salir las dos, con role = admin
   select email, role, is_owner from public.cdf_members where is_owner or lower(email) in ('john.farggi@gmail.com', 'jerold.ambrocio@gmail.com');
   ```
   El permiso solo vale en cuentas admin: si alguna de las dos no sale como admin, preguntar antes de cambiarle el rol.
   Sin este paso nadie puede borrar definitivamente (la papelera funciona igual).
3. Funciones: `cdf-public-order` (tiendas para recoger), `cdf-lalamove` (reserva protegida, `booking.ts`, enlace por
   webhook) y la nueva `cdf-order-purge` (borrado definitivo: borra el pedido y quita sus archivos del almacenamiento;
   `verify_jwt = true`, usa `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`, que Supabase ya pone).
4. Web (Netlify).

El formulario publicado hoy sigue funcionando entre los pasos 1 y 4 (la base de datos acepta recogidas sin tienda).

## Comprobaciones después

- `select count(*) from cdf_orders where deleted_at is not null;` → 0
- La solicitud R2 muestra «Pedido #0007 eliminado».
- `select public.cdf_request_counts();` como admin devuelve recuentos.
- Un pedido con rider activo no se puede mover a la papelera.
- Decisiones del dueño (12/11/2026): Delivery se llama «In transit» (antes «On the way»); el borrado definitivo
  borra todo, archivos incluidos, con aviso y escribiendo el número; las floristas no necesitan más bloqueo de lectura.

## Vuelta atrás

`supabase/rollback/20261111_phases_1-5_down.sql` (probado en `tests/production-parity.cjs`). Antes, restaurar o
decidir los pedidos que estén en la papelera y exportar `cdf_order_audit` si hace falta.
