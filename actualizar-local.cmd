@echo off
setlocal
rem Actualiza la rama actual sin cambiar de rama ni descartar cambios.
cd /d "%~dp0"
for /f "delims=" %%b in ('git branch --show-current') do set "RAMA=%%b"
if not defined RAMA goto fail
git diff --quiet || goto fail
git diff --cached --quiet || goto fail
git fetch origin "%RAMA%" || goto fail
git merge --ff-only "origin/%RAMA%" || goto fail
echo LISTO: rama %RAMA% actualizada.
pause
exit /b 0
:fail
echo ERROR: no se pudo actualizar. Revisa cambios locales, rama o conexion. No se descartan cambios.
pause
exit /b 1
