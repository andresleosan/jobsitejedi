# Storage Policy Consolidation

La migración `20260807120000_consolidate_storage_object_policies.sql` deja una sola policy por combinación `bucket_id` y acción. No elimina objetos; solo reemplaza autorización y visibilidad de buckets.

## Matriz

| Bucket | Público | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---:|---|---|---|---|
| `job-photos` | No | Usuarios autenticados | Managers | No | No |
| `job-completion-photos` | No | Dueño de completion o manager | Dueño de completion | No | No |
| `daily-report-photos` | No | Dueño de path o manager | Dueño de path | No | No |
| `job-voice-notes` | No | Dueño de path o manager | Dueño de path | No | No |
| `job-review-voice-notes` | No | Managers | Managers | No | No |
| `invoices` | No | Dueño o manager | Dueño | Dueño | Dueño o manager |
| `documents` | No | Usuarios autenticados | Managers | Managers | Managers |
| `storage-material-photos` | No | Managers autenticados | Managers | Managers | Managers |
| `rubbish-photos` | No | Dueño de path o manager | Usuarios autenticados | No | Managers |
| `risk-assessments` | Sí | Público | Managers | No | Managers |

## Rollback

Antes de aplicar la migración, exportar `storage.buckets` y `pg_policies` para `storage.objects`. Para revertirla, restaurar esos dos dumps en una ventana controlada, verificando primero un backup reciente y el estado de las policies en staging. La migración no debe aplicarse en producción sin confirmación explícita del operador.

La verificación posterior está en `supabase/scripts/verify-storage-policies.sql`; se ejecuta en staging y no modifica datos.
