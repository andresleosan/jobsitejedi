# Configuración de Supabase

Esta guía deja el repositorio preparado para completar la configuración cuando haya acceso al proyecto Supabase.

## Variables locales

Configurar localmente estas variables en `.env`:

```text
VITE_SUPABASE_PROJECT_ID=<project-ref>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

`.env` no debe versionarse. El contrato sin credenciales está en `.env.example`.

## Storage

1. Crear un backup verificable de `storage.buckets` y de las policies de `storage.objects`.
2. Aplicar `supabase/migrations/20260807120000_consolidate_storage_object_policies.sql` primero en staging.
3. Ejecutar `supabase/scripts/verify-storage-policies.sql` y comprobar que no devuelve policies faltantes ni legadas.
4. Probar acceso anónimo, builder y manager por bucket antes de producción.
5. Aplicar en producción solo con confirmación operativa y rollback disponible.

La migración no elimina objetos. Las rutas antiguas guardadas como URLs completas se normalizan en frontend antes de generar URLs firmadas.

## Rotación

Si `.env` estuvo versionado, invalidar la clave anterior desde el panel de Supabase y actualizar únicamente el `.env` local. No registrar la nueva clave en Git, logs ni capturas.
