# Supabase heredado: inventario y frontera de runtime

Estado: archivado, fuera del runtime Firebase. Fecha de inventario: `2026-08-25`.

Firebase es el proveedor único de runtime para autenticación, Firestore, Storage y Cloud
Functions. Supabase se conserva únicamente como historial, referencia de auditoría y material
para una eventual validación operativa autorizada.

## Inventario

- `supabase/migrations/`: 67 migraciones históricas. No se cargan ni aplican automáticamente.
- `supabase/functions/`: 3 Edge Functions históricas. No forman parte del backend desplegado por
  Firebase; `cleanup-old-projects` contiene borrados, por lo que no debe ejecutarse sin un plan
  aprobado.
- `supabase/scripts/verify-storage-policies.sql`: consulta de verificación; no modifica datos,
  pero requiere conexión explícita al proyecto correcto.
- `supabase/config.toml`: configuración histórica del CLI de Supabase.
- `AUDITORIA.md`, `docs/storage-policy-consolidation.md` y `docs/supabase-setup.md`: referencias
  históricas y procedimientos de staging, no instrucciones para activar Supabase en la app.

## Frontera actual

Las únicas fuentes de runtime de la aplicación son `src/`, `functions/src/`, las reglas Firebase
y las dependencias declaradas en `package.json`. El guard `tests/provider-guard.test.ts` verifica
que `src/` y `functions/src/` no importen ni invoquen Supabase. El frontend tampoco conserva las
variables `VITE_SUPABASE_*`.

No se importan datos históricos de Supabase ni se mantiene una capa de compatibilidad híbrida.
Las URLs, políticas y nombres de buckets encontrados en las migraciones no representan por sí
solos el estado actual de producción.

## Controles antes de cualquier retirada

No ejecutar `supabase db push`, `supabase functions deploy`, una migración Storage ni un borrado
de tablas/objetos en producción desde este repositorio. Si el operador decide reactivar o retirar
el proveedor, el cambio exige, en este orden:

1. Confirmar el proyecto y el entorno objetivo.
2. Exportar y verificar backup de `storage.buckets` y `pg_policies` sobre `storage.objects`.
3. Probar el cambio en staging y documentar rollback.
4. Comparar políticas efectivas en `pg_policies` con la evidencia esperada.
5. Obtener confirmación explícita antes de cualquier acción en producción.

En esta tarea no se validó el estado remoto de `pg_policies`, porque no hay acceso autorizado al
proyecto Supabase. Por tanto, la retirada documental queda en revisión y no se declara apagado
el proveedor remoto.
