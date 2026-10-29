# Gestor de dependencias: decisión de seguridad (2026-10-26)

npm y `package-lock.json` son la fuente de instalación soportada. CI usa `npm ci`; README documenta npm. No se encontró una instalación Bun activa en scripts, CI o documentación del repositorio.

El lockfile obsoleto `bun.lockb` se retiró del repositorio. npm y `package-lock.json` son la única fuente soportada para instalar, compilar y desplegar. Recuperar soporte Bun requiere regenerar y validar su lockfile en un cambio separado.
