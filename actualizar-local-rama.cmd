@echo off
rem Usa la rama actual; no cambia a una rama antigua.
call "%~dp0actualizar-local.cmd"
exit /b %errorlevel%
