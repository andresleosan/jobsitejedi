# Plan de Mejoras de Seguridad y Calidad

## Objetivo
Reducir exposición de datos y corregir deudas de frontend detectadas en la auditoría, manteniendo cambios trazables por migración y con verificación.

## Prioridad P0 — Acción inmediata (bloqueante)

### 1) Normalizar políticas de Storage (documentos y fotos con acceso no controlado)
- Sustituir las políticas tipo `Everyone`/`Public` por políticas explícitas por rol o propietario en:
  - `documents`
  - `storage-material-photos`
  - `rubbish-photos`
  - `job-photos`
  - `job-completion-photos`
- Crear migración nueva que:
  - Dropee **todas** las políticas legadas por nombre exacto para evitar residuales.
  - Reclasifique `job-photos`/`job-completion-photos` con reglas por `owner`, `manager` y relación a tabla de dominio.
  - Mantenga `bucket` privado salvo casos de negocio que justifiquen lo contrario.
- Evidencia esperada: acceso anónimo denegado en estas rutas y acceso por rol validado.

### 2) Arreglar `.env` en repositorio
- Añadir `.env` a `.gitignore`.
- Añadir `.env.example` con placeholders para variables públicas requeridas.
- Documentar en `README.md` que las variables sensibles no deben versionarse.

### 3) Cambiar manejo de URLs de Storage en frontend a patrón seguro
- Reemplazar `getPublicUrl` en lugares donde el bucket no es claramente público por:
  - `createSignedUrl` para visualización/control (`StorageMaterialsTab`, `DailyReportDialog`, `ManagerRiskAssessmentDialog`, `ManagerFeedbackDialog`, `RubbishCollectionDialog`, etc.).
- Añadir utilitario central para generar URLs firmadas con TTL definido.
- Añadir tests manuales de que una sesión no autorizada no descarga archivos.

## Prioridad P1 — Corto plazo

### 4) Reforzar gestión de sesión y cookies del cliente
- `src/pages/Builders.tsx:296` y `src/pages/Managers.tsx:171`:
  - reemplazar `localStorage.removeItem('sb-...-auth-token')` por manejo estándar con `supabase.auth.signOut({ scope: 'global' })` + limpieza general si hace falta.
- `src/components/ui/sidebar.tsx:68`:
  - si se continúa con cookie para estado UI, fijar `SameSite=Lax|Strict`, `Secure` y expiración explícita adecuada.

### 5) Reducir riesgo de XSS/DOM manipulación
- Sustituir `container.innerHTML = ""` en `QRScannerDialog` con API DOM (`textContent`/`replaceChildren`).
- Reemplazar `dangerouslySetInnerHTML` en `src/components/ui/chart.tsx` con construcción segura de estilo vía `style` literal o map de clases.
- Mantener auditoría del componente de terceros (`html5-qrcode`) para entradas no confiables.

### 6) Tipado estricto en puntos críticos
- Priorizar reducción de `any` en:
  - `ChangeProjectDialog`, `BuilderDashboard`, `ProjectDetails`, `JobsToDoList`, `JobReviewDialog`, `ManagerFeedbackDialog`.
- Objetivo: mejorar detección de errores de campos sensibles (IDs de usuario, roles, rutas de photo_url).

## Prioridad P2 — Sostenibilidad

### 7) Endurecimiento operativo y QA de seguridad
- Añadir suite simple de verificación para políticas Storage:
  - script/SQL que liste `pg_policies` por `storage.objects` + `bucket_id` para validar que no queden políticas globales obsoletas.
  - checklist de smoke de acceso: anónimo vs autenticado por bucket crítico.
- Documentar cambios en `AUDITORIA.md` con fecha y evidencia de `pnpm/npm test`/scripts.

## Riesgo remanente aceptado (si aplica)
- `getPublicUrl` en `EnhancedInvoiceDialog` puede seguir siendo útil para integración con funciones externas, pero debe limitarse a URL de procesamiento y evitar persistencia innecesaria en DB.

## Próximo ciclo de implementación recomendado
1. Aplicar migración de cierre de acceso Storage.
2. Ejecutar build + checks de acceso manual/automatizado.
3. Ajustar frontend (URLs firmadas + sesión).
4. Cerrar tickets de deuda (`any`, `innerHTML`, `dangerouslySetInnerHTML`) en un sprint separado.
