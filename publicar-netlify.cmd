@echo off
setlocal
rem Publica el commit actual. No actualiza ni cambia de rama automaticamente.
cd /d "%~dp0"
set "SITE=79c4bd06-b12f-4f92-9b06-8be1c54cbae0"
git diff --quiet || goto fail
git diff --cached --quiet || goto fail
for /f %%c in ('git rev-parse --short HEAD') do set "COMMIT=%%c"
if not defined COMMIT goto fail
echo Se publicara el commit %COMMIT% de la rama actual.
choice /C SN /N /M "Publicar en produccion? [S/N] "
if errorlevel 2 exit /b 0
set "OUT=%TEMP%\cdf-deploy-%RANDOM%%RANDOM%"
mkdir "%OUT%" || goto fail
git archive --format=zip --output="%OUT%\web.zip" HEAD index.html seguimiento.html pedido.html styles.css config.js i18n.js tracking.js sw.js manifest.webmanifest js img _redirects netlify.toml || goto fail
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $archive=Join-Path $env:OUT 'web.zip'; Expand-Archive -LiteralPath $archive -DestinationPath $env:OUT; Remove-Item -LiteralPath $archive" || goto fail
if not exist "%OUT%\pedido.html" goto fail
if not exist "%OUT%\index.html" goto fail
for /f %%t in ('powershell -NoProfile -Command "(Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')"') do set "TS=%%t"
if not defined TS goto fail
>"%OUT%\version.json" echo {"v":"%COMMIT%-%TS%"}
where netlify >nul 2>&1
if errorlevel 1 (
  call npx -y netlify-cli deploy --prod --no-build --dir "%OUT%" --site %SITE% --message "Deploy %COMMIT%" || goto fail
) else (
  call netlify deploy --prod --no-build --dir "%OUT%" --site %SITE% --message "Deploy %COMMIT%" || goto fail
)
echo LISTO: publicada la version %COMMIT%-%TS%. Archivos temporales: %OUT%
pause
exit /b 0
:fail
echo ERROR: operacion interrumpida. Revisa el mensaje anterior; no se descartan cambios locales.
pause
exit /b 1

