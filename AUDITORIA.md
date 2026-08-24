# Auditoría de Seguridad y Riesgos

## Estado
- Fecha de revisión: `2026-08-07`
- Alcance: reglas de RLS de Supabase Storage y uso de almacenamiento en frontend (módulos `supabase/migrations` y `src`)
- Resultado: **se detectaron hallazgos de seguridad y de robustez**. No se aplicaron cambios en código.

## Metodología
- Revisión de migraciones de Storage en orden cronológico para confirmar políticas vigentes (`CREATE POLICY`, `DROP POLICY`, `storage.buckets`).
- Revisión de usos de `getPublicUrl`, `createSignedUrl`, cookies y manejo de sesión en frontend.
- Verificación de control de secretos en archivos de configuración.

## Hallazgos críticos

### 1) Exposición pública persistente en Storage por políticas no eliminadas
**Severidad:** ALTA

- `supabase/migrations/20251223204650_aa86b67f-1495-4dbd-b619-8a856bee8d56.sql:2-3` crea `documents` con `public = true`.
- `supabase/migrations/20251223204650_aa86b67f-1495-4dbd-b619-8a856bee8d56.sql:13-17` define `USING (bucket_id = 'documents')` sin filtro de usuario.
- `supabase/migrations/20260115213644_501ea7b8-85df-4638-92f4-889490c2f931.sql:3-18` intenta limpiar políticas viejas, pero **no elimina** la política pública existente con otro nombre.
- `supabase/migrations/20260102022921_63d818c9-d5e5-45e9-8ea8-204654ea9e92.sql:6-7` crea `storage-material-photos` como público.
- `supabase/migrations/20260102022921_63d818c9-d5e5-45e9-8ea8-204654ea9e92.sql:11-13` define `Everyone can view material photos`.
- `supabase/migrations/20251226233457_c75ee08e-312a-4ed3-aa7a-42cb32433255.sql:50-52` crea `rubbish-photos` con `public = true`.
- `supabase/migrations/20251226233457_c75ee08e-312a-4ed3-aa7a-42cb32433255.sql:59-61` permite `SELECT` público.
- `supabase/migrations/20260115213644_501ea7b8-85df-4638-92f4-889490c2f931.sql:8-18,54-76` recrea políticas por bucket con nombre *Authenticated...* pero sin remover las anteriores de lectura pública.
- `supabase/migrations/20251104221324_bda32282-0465-47de-acb9-7e2b56f668ac.sql:2-3` crea `job-photos` y `supabase/migrations/20251104221324_bda32282-0465-47de-acb9-7e2b56f668ac.sql:13-15` define `Everyone can view job photos`.

**Impacto:** cualquier actor puede consultar archivos de esos buckets si conoce o adivina rutas; además el frontend guarda y reutiliza `publicUrl` para los mismos buckets (`StorageMaterialsTab`, `DailyReportDialog`, `ManagerRiskAssessmentDialog`, `EnhancedInvoiceDialog`, `RubbishCollectionDialog`, `ManagerFeedbackDialog`).

### 2) Lectura de fotos de completado de trabajo con control insuficiente
**Severidad:** MEDIA-ALTA

- `supabase/migrations/20251103215419_b5813987-caea-4545-a3bb-cf7b5a3bfa8e.sql:116-117` habilita `SELECT` en `job-completion-photos` por `bucket_id` sin validar propietario/completado.
- `supabase/migrations/20251109133052_edd1e7b9-e8ad-4c08-8638-ea910e1a9526.sql:10-15` permite a cualquier usuario autenticado leer el bucket (`Authenticated can read job completion photos`).
- `src/components/jobs/JobSubmissionDialog.tsx`, `src/components/jobs/JobReviewDialog.tsx` y `src/pages/ProjectDetails.tsx` obtienen URLs con `createSignedUrl` para miniaturas y original.

**Impacto:** cualquier sesión autenticada puede enumerar/descargar fotos de completados de cualquier usuario, aunque el bucket no sea público.

### 3) Exposición de configuración de Supabase en repositorio
**Severidad:** MEDIA

- `.env:1-3` contiene `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`.
- `.gitignore:1-24` no excluye `.env`.

**Impacto:** aunque es clave *publishable*, mantener credenciales de entorno en repositorio aumenta riesgo de abuso, scraping de configuración y fuga operativa; además dificulta rotación segura.

## Hallazgos de riesgo medio/bajo

### 4) Uso de `getPublicUrl` en buckets con restricciones de acceso
**Severidad:** BAJA

- `src/components/storage/StorageMaterialsTab.tsx:107-116` (`storage-material-photos`) usa `getPublicUrl`.
- `src/components/dashboard/DailyReportDialog.tsx:84-93` (`daily-report-photos`) usa `getPublicUrl`.
- `src/components/dashboard/ManagerRiskAssessmentDialog.tsx:158-167` (`documents`) usa `getPublicUrl`.
- `src/components/jobs/ManagerFeedbackDialog.tsx:67-87` (`job-photos`) usa `getPublicUrl`.
- `src/components/dashboard/EnhancedInvoiceDialog.tsx:86-95` (`invoices`) usa `getPublicUrl` para procesamiento de IA.
- `src/components/dashboard/RubbishCollectionDialog.tsx:165-173` (`rubbish-photos`) usa `getPublicUrl`.

**Impacto:** mezcla de URLs públicas con buckets que deberían ser privadas o por-sesión; favorece inconsistencias de seguridad y exposición accidental si el bucket se vuelve público.

### 5) Señales de robustez y hardening en frontend
**Severidad:** BAJA

- `src/components/ui/sidebar.tsx:68` setea cookie sin flags `Secure`/`SameSite`.
- `src/pages/Builders.tsx:296` y `src/pages/Managers.tsx:171` limpian un token localStorage con key hardcodeada del proyecto.
- `src/components/auth/QRScannerDialog.tsx:82` usa `container.innerHTML = ""`.
- `src/components/ui/chart.tsx:69-86` usa `dangerouslySetInnerHTML` en generación CSS.
- `src/components/jobs/JobsToDoList.tsx:78-79` desactiva `react-hooks/exhaustive-deps`.

**Impacto:** mayor superficie de regresión y dificultad de mantenimiento; no se considera acceso directo de datos críticos hoy, pero sí deuda de seguridad de frontend.

## Matriz de buckets (estado actual)

| Bucket | Público (`buckets`) | Política de lectura efectiva | Riesgo | Evidencia principal |
|---|---|---|---|---|
| `documents` | Sí (`public = true`) | `SELECT` sin autenticación | Alto | `supabase/migrations/20251223204650_aa86b67f-1495-4dbd-b619-8a856bee8d56.sql:2-3,13-17` |
| `storage-material-photos` | Sí (`public = true`) | Lectura pública persistente | Alto | `supabase/migrations/20260102022921_63d818c9-d5e5-45e9-8ea8-204654ea9e92.sql:6-7,11-13` |
| `rubbish-photos` | Sí (`public = true`) | Lectura pública persistente | Alto | `supabase/migrations/20251226233457_c75ee08e-312a-4ed3-aa7a-42cb32433255.sql:50-52,59-61` |
| `job-completion-photos` | No (`public = false`) | `SELECT` amplio para autenticados | Media | `supabase/migrations/20251109133052_edd1e7b9-e8ad-4c08-8638-ea910e1a9526.sql:10-15`, `supabase/migrations/20251103215419_b5813987-caea-4545-a3bb-cf7b5a3bfa8e.sql:116-117` |
| `job-photos` | No (`public = false`) | `SELECT` global | Alta | `supabase/migrations/20251104221324_bda32282-0465-47de-acb9-7e2b56f668ac.sql:2-3,13-15` |
| `daily-report-photos` | No (`public = false`) | `SELECT` por owner/manager | Bajo | `supabase/migrations/20251102214902_9132a90d-d256-4cc7-a5c0-560b8ae4641b.sql:70-96` |
| `invoices` | No (`public = false`) | owner + manager | Bajo | `supabase/migrations/20251101095419_c5a03fe8-1359-4aee-a148-40eca2e9bcea.sql:6-10,13-24` |

## Recomendación operativa
- Priorizar corrección de buckets de riesgo alto antes de próximos despliegues.
- Validar migraciones finales con consulta a `pg_policies` y test de acceso anónimo/autenticado para cada bucket.
