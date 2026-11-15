# Instrucciones del proyecto

- Actualizar siempre `js/changelog.js` con cada cambio funcional o corrección visible, en el mismo trabajo, en español e inglés y con la fecha correspondiente. No esperar a publicar para registrar las novedades.
- No publicar en Netlify sin una petición o consentimiento explícito del usuario para esa publicación. Una autorización anterior no autoriza publicaciones posteriores.
- Mantener GitHub actualizado con los arreglos terminados y comprobados: hacer commit y push a `main`, salvo que Jerold pida expresamente solo local o que exista un bloqueo real. Esta autorización NO incluye Netlify. Verificar antes del push que no dispare builds automáticos; si no puede verificarse, comunicar el bloqueo sin desplegar.
- Animaciones completas por defecto, independientemente de `prefers-reduced-motion`. Mantener una opción manual persistente para reducirlas y transiciones rápidas y suaves.

## Carpeta compartida y publicación por lotes
- Carpeta única de trabajo para Codex y Claude Code: `C:\Users\jerol\pedidos-cdf`.
- No trabajar en `C:\Users\jerol\Documents\Codex\pedidos-cdf` ni crear nuevas copias o worktrees salvo petición explícita de Jerold.
- Antes de editar, revisar `git status` y los cambios existentes. No sobrescribir ni revertir cambios del otro agente. Evitar editar el mismo archivo simultáneamente.
- Acumular los arreglos en local para publicarlos juntos. Actualizar las novedades en español e inglés con cada cambio visible.
- Cuando Jerold solicite publicar el lote, actualizar primero GitHub y desplegar exactamente ese commit a Netlify una sola vez. Verificar antes si el push activa un despliegue automático para no duplicarlo.
- Preparar o arreglar no autoriza publicar, ejecutar build hooks ni desplegar previews. No aplicar cambios a servicios de producción sin autorización explícita.


## Fuente de verdad y versión publicada
- `origin/main` debe contener todo el trabajo terminado y comprobado. No dejar arreglos exclusivamente en una rama o carpeta. No hacer force-push ni descartar trabajo de otros.
- Antes de cualquier publicación, comprobar árbol limpio y que el SHA local exista en GitHub. Publicar exactamente ese commit, solo cuando Jerold lo pida.
- Estado comprobado el 15/11/2026: Netlify no tiene repositorio conectado ni build settings; publica mediante CLI. Volver a verificar si cambia la configuración.
- Que un fix esté en GitHub no significa que esté en Netlify. Informar siempre por separado de local, GitHub y producción.
- Consultar `docs/SYNC-AUDIT-2026-11-15.md` para el alcance y límites de la reconciliación.
