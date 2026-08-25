# Supabase heredado

Este directorio es histórico y está fuera del runtime de Jobsite Jedi. La aplicación activa usa
Firebase para Auth, Firestore, Storage y Cloud Functions.

- No ejecutar migraciones ni Edge Functions desde aquí contra producción.
- No añadir imports de estos artefactos a `src/` o `functions/src/`.
- Consultar [`docs/legacy-supabase.md`](../docs/legacy-supabase.md) antes de cualquier validación.
- Toda acción remota exige staging, backup verificable, rollback y confirmación explícita.

La función histórica `cleanup-old-projects` contiene operaciones destructivas y permanece sin
ejecutar.
