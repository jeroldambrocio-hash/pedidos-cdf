# Reconciliación de código y auditorías — 15/11/2026

## Estado inicial comprobado

- GitHub main: baa00dd12d659acc20fe33b15f63e9701af58723.
- Rama codex/fix-audit-session-recovery-2026-11-14 y carpeta C:\Users\jerol\pedidos-cdf: ccb409a9b9ed106c8559ae8979a4e734883465c6, cinco commits por delante de main.
- Todas las demás ramas remotas son antecesoras de esa rama; ninguna aporta commits adicionales pendientes.
- Cambios locales existentes: contador por rol en js/profile.js, historial ES/EN ampliado y archivos de instrucciones. Se conservan e incluyen; no se atribuye su autoría a un agente por el nombre de la carpeta.
- La copia Documents\Codex\pedidos-cdf solo aporta una nota de asignación redundante y documentos de redirección. No se importa código anterior.

## Cobertura de las auditorías

| Hallazgo | Corrección incluida y comprobación |
|---|---|
| Integral C01: respuestas de otra sesión | Generación de sesión en pago, perfil, editor y otros flujos; audit-fixes-ui y session-switch-ui |
| Integral C02: avatar borrado antes de confirmar | Conserva el anterior al fallar y lo borra después de confirmar; audit-fixes-ui |
| Integral C03: CSV incompleto o papelera | Exportación de 1.004 pedidos válidos con API de 37 filas; audit-fixes-ui |
| Integral C04: fallos temporales parecen falta de acceso/esquema | Reintentar y conservar capacidades; startup-recovery-ui |
| Integral C05: recogida sin tienda para la propia florista | Lee datos de su propio perfil; audit-fixes-ui y pickup-ui |
| Sondeo de sucursales con coordenadas nulas | Coordenadas válidas; startup-recovery-ui |
| Segunda auditoría F01: foto de la cuenta anterior | Retira visor e imagen; session-overlays-ui |
| Segunda auditoría F02: confirmación ejecutada bajo otra cuenta | Invalida confirmación al cambiar sesión; session-overlays-ui |
| Segunda auditoría F03: helpers vuelven a main o excluyen pedido.html | Helpers del commit f153a82 conservan rama, no usan reset destructivo e incluyen pedido.html. No se ejecutan despliegues como prueba |

Los cinco commits reconciliados son cf14d4e, 29ab5e9, f153a82, ff967fb y ccb409a. Incluyen también fotos de referencia/pago obligatorias y borde/espacio del destacado.

## Copias históricas

Se compararon 21 carpetas: fuentes, paquetes y copias de auditoría de los días 12–14/11/2026, la copia antigua de Codex y el worktree pedidos-cdf-arreglos. Se contrastó contenido con los blobs del historial de la rama vigente, normalizando CRLF/LF y líneas vacías finales de exportaciones. No se importan automáticamente variantes antiguas.

Las variantes no idénticas se contrastaron con el código vigente: horario AM/PM definitivo en lugar de prototipos am/pm, conservación de completados, fotos obligatorias, avatares y scripts de publicación. No se identificó una mejora funcional exclusiva de esas copias que falte en este lote. Los helpers antiguos con reset --hard son inferiores y no se recuperan. Las modificaciones de mocks y los textos intermedios de novedades no son arreglos de producto pendientes.

Esta comparación no certifica todas las conversaciones históricas ni integra prototipos independientes de PayMongo. Se limita a las copias de auditoría identificadas y al repositorio Pedidos CDF.

## Producción observada, sin modificar

- Netlify: sitio 79c4bd06-b12f-4f92-9b06-8be1c54cbae0; deploy 6af8cdc81d158a575c8c3a83, creado el 14/11/2026 a las 21:08 UTC.
- version.json público: ccb409a-20261114210819. Los 29 HTML/CSS/JS/manifest comparados coinciden con ccb409a al normalizar CRLF/LF (4 coinciden byte por byte).
- API getSite: build_settings vacío; repo, repo_url, repo_path y provider ausentes. No hay integración Git de builds. No se cambia esta configuración.
- Las nuevas notas y el contador por rol quedan para la próxima publicación. Actualizar GitHub no publica estos cambios.

## Validación y corrección encontrada durante la reconciliación

- Pasan session-overlays-ui, audit-fixes-ui, startup-recovery-ui, session-switch-ui, quick-pay-ui, pickup-ui y requests-ui con mocks locales.
- Pasan las comprobaciones de perfil admin/florista, exclusión de admins del selector y preservación de asignaciones antiguas; se incorpora tests/profile-role-ui.cjs.
- Pasa audit-stats-search-db con base PGlite desechable.
- public-order.test.mjs fallaba porque el cambio ff967fb conservó dos recuentos de una solicitud que ahora se rechaza por faltar fotos. Se corrigen a una solicitud y un aviso, y se comprueba explícitamente que el rechazo no inserta una solicitud. La suite completa pasa, incluidas cuotas, archivos privados, permisos, idempotencia y logs sin datos personales.
- Los tests usan NODE_PATH para Playwright, PGlite y jpeg-js; el adaptador local-network-routing evita llamadas reales. No se realizan operaciones con clientes, repartos ni proveedores reales.

## Límites

Los riesgos no demostrados de las auditorías (timeouts del servidor compartido, recepción real de correo/push, proveedores externos, metadatos de secretos y explotabilidad de avisos de dependencias) siguen pendientes de su verificación específica. Tener el código reconciliado no implica que esos riesgos estén resueltos. No se aplican migraciones ni se despliegan funciones Edge.

Comprobaciones adicionales completadas: trash-ui y completed-retention-ui pasan. Sintaxis de los scripts de aplicación y diff --check correctos.
