# Correcciones de la auditoría integral

Se corrigen los fallos reproducidos en la auditoría del 14/11/2026. No requiere migraciones, cambios de secretos ni despliegue de funciones Edge.

- Las respuestas atrasadas de perfil, pagos y guardados de pedidos se descartan si cambia la sesión. Se extiende la protección a restauraciones, transiciones, equipo y solicitudes; las acciones de Deshacer/Detalles tampoco reutilizan el contexto de otra cuenta.
- El avatar anterior solo se elimina después de confirmar que el perfil apunta al nuevo. Una respuesta fallida o ambigua conserva la imagen anterior.
- El CSV pagina con recuento exacto y orden estable, y excluye la papelera. El control de archivados conserva su comportamiento.
- Los fallos temporales de pertenencia o esquema muestran un arranque recuperable con Reintentar. Una consulta correcta sin miembro sigue mostrando Sin acceso; las columnas realmente ausentes siguen admitiendo esquemas antiguos.
- La recogida de la propia florista usa su perfil, sin ampliar los datos que expone el directorio de equipo.
- La detección de sucursales usa coordenadas válidas y deja de provocar un error 400 deliberado.

## Regresiones

`tests/audit-fixes-ui.cjs` cubre respuestas atrasadas de perfil/pago/editor, avatar fallido y confirmado, recogida y CSV con más de 1.000 filas y un API limitado a 37 por página. `tests/startup-recovery-ui.cjs` cubre pertenencia temporalmente indisponible, reintento completo, conservación de capacidades y columnas opcionales realmente ausentes.

Requieren Playwright y Chrome. Pueden ejecutarse con el adaptador local existente:

```text
node -r ./tests/local-network-routing.cjs tests/audit-fixes-ui.cjs
node -r ./tests/local-network-routing.cjs tests/startup-recovery-ui.cjs
```

Las dependencias de pruebas se resuelven mediante NODE_PATH, como en el resto de suites del repositorio. No se usa Supabase real. Los archivos y clientes de prueba son ficticios.

También se verificaron los flujos existentes de pago rápido, cambio de sesión, recogida, solicitudes, papelera, retención, equipo, funciones desactivadas, Lalamove y acceso a estadísticas. Los mocks de Lalamove y la expectativa horaria de papelera se actualizan al contrato actual.

Estas correcciones no constituyen una certificación de los proveedores externos ni resuelven los riesgos que la auditoría dejó sin verificar. La publicación en producción queda separada de esta entrega.
