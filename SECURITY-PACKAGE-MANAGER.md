# Gestor de dependencias: decisión de seguridad (2026-10-26)

npm y `package-lock.json` son la fuente de instalación soportada. CI usa `npm ci`; README documenta npm. No se encontró una instalación Bun activa en scripts, CI o documentación del repositorio.

Se conservan `bun.lockb` como evidencia histórica obsoleta; no están corregidos por este cambio y no deben usarse para instalar, compilar o desplegar. Usar `npm ci` desde el lock actualizado. Recuperar soporte Bun requiere regenerar y validar su lock desde el manifiesto actualizado en un cambio separado.
