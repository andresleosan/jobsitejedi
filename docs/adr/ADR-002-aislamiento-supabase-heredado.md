# ADR-002: Aislar Supabase heredado fuera del runtime

Fecha: `2026-08-25`

Estado: `aceptada`

## Contexto

La migración a Firebase eliminó las referencias runtime de Supabase del frontend, pero el
repositorio conserva 67 migraciones, 3 Edge Functions, configuración CLI y scripts SQL. Algunos
artefactos históricos contienen políticas Storage públicas y operaciones destructivas. Borrarlos
sin verificar el estado remoto podría eliminar evidencia necesaria o dificultar un rollback.

## Decisión

Conservar la infraestructura Supabase dentro de `supabase/` como historial explícitamente aislado,
sin cargarla desde `src/` o `functions/src/`, y documentar que no se puede desplegar ni aplicar en
producción sin staging, backup, rollback y confirmación del operador.

## Alternativas consideradas

- **Borrar el directorio Supabase:** descartado porque no existe evidencia de backup ni validación
  de `pg_policies` en el proyecto remoto.
- **Mantenerlo como proveedor activo:** descartado por la sesión y autorización divididas que
  motivaron ADR-001.
- **Aislarlo como historial:** aceptado porque preserva trazabilidad sin reintroducir dependencias
  runtime ni ejecutar cambios remotos.

## Consecuencias

- El guard de proveedor protege `src/` y `functions/src/` contra nuevas referencias Supabase.
- Las migraciones y funciones históricas siguen disponibles para auditoría, pero no son evidencia
  suficiente del estado actual de producción.
- La retirada física del proveedor y cualquier migración remota quedan pendientes de un checkpoint
  operativo con acceso al proyecto, backup y rollback.
