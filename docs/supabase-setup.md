# Validación histórica de Supabase (solo staging)

Supabase ya no es un proveedor de runtime de Jobsite Jedi. Esta guía no activa la aplicación ni
autoriza despliegues: sirve únicamente para una eventual validación forense o migración controlada
si el operador concede acceso al proyecto y confirma el checkpoint correspondiente.

## Variables y credenciales

No configurar variables `VITE_SUPABASE_*` para el frontend. Si una validación operativa necesita
credenciales, deben inyectarse solo en el entorno temporal autorizado y nunca escribirse en Git,
logs, capturas ni archivos `.env` versionados.

## Validación Storage en staging

1. Crear un backup verificable de `storage.buckets` y de las policies de `storage.objects`.
2. Confirmar que el proyecto y el entorno son staging antes de usar el CLI.
3. Ejecutar `supabase/scripts/verify-storage-policies.sql`, que es de lectura, y conservar su salida.
4. Si se propone aplicar `20260807120000_consolidate_storage_object_policies.sql`, documentar
   rollback y probar acceso anónimo, builder y manager por bucket antes de producción.
5. Aplicar en producción solo con backup reciente, rollback probado y confirmación operativa.

La migración de consolidación no debe asumirse aplicable solo porque exista en el repositorio; las
políticas efectivas se deben comprobar en `pg_policies`.

## Rotación si hubo exposición

Si una credencial Supabase estuvo versionada o expuesta, invalidarla desde el panel del proveedor
antes de continuar. No registrar la nueva credencial en Git, logs ni capturas.
