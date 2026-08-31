# Consolidación Firebase en `jobsitejedi`

Estado: corte productivo verificado el 2026-08-31; `jobsitejedi-staging` permanece intacto.

## Alcance y límites

El backend, las reglas y el cliente vigentes se consolidaron en `jobsitejedi`. La operación incluyó
la reconciliación dirigida de autorización Auth↔Firestore necesaria para el contrato de grants v4;
no importó ni migró proyectos, jobs, facturas, fotos o archivos desde staging.

La retirada de `jobsitejedi-staging` no forma parte de este corte. Solo puede ocurrir después de la
nueva ventana de observación, un inventario final, smoke y revisión de costo satisfactorios, y una
confirmación destructiva separada en el momento del borrado.

## Manifiesto inmutable del corte — 2026-08-31

### Código, CI y frontend

- Contrato v4: PR [#3](https://github.com/andresleosan/jobsitejedi/pull/3), candidato
  `3de173e12a6e4ba0b8f1e01057db3f3b951078ac`, merge
  `aaf8aad42ac009a46eacf03ee33c3419aeaa2210`.
- Estabilización de sesión: PR [#4](https://github.com/andresleosan/jobsitejedi/pull/4), candidato
  `557caac763c8ae67ba3766d2e4958f9662afc70f`, release de aplicación
  `864335ecf4e497221469e3462a623c5211e5846e`.
- El [CI del candidato](https://github.com/andresleosan/jobsitejedi/actions/runs/33432508491) y el
  [CI exacto de `main`](https://github.com/andresleosan/jobsitejedi/actions/runs/33433050837)
  terminaron verdes en sus dos jobs y publicaron evidencia QA inmutable.
- Vercel aceptó la configuración Firebase/App Check oficial y publicó el deployment
  `HVMXDbSrwh8XYaXram1b99M7N3Vx` como `Ready`/producción para la release de aplicación. La ruta
  pública es [jobsitejedi.vercel.app](https://jobsitejedi.vercel.app/).

### Autorización productiva

El inventario posterior, registrado sin correos, UIDs, tokens ni valores de grants, fue:

| Comprobación | Resultado |
| --- | ---: |
| Usuarios Auth totales | 5 |
| Usuarios activos autorizados | 2 |
| Identidades QA compartidas deshabilitadas | 3 |
| Grants activos exactos | 2 |
| Tombstones QA inactivos | 3 |
| Diferencias Auth↔Firestore | 0 |

El recibo redactado versionado está en
[`evidence/production-auth-cutover-20260831.json`](evidence/production-auth-cutover-20260831.json)
(Git blob `8d4ea8364b81305b78e10e1517a07e55917ce532`).

Las identidades QA compartidas no se reactivaron: quedaron deshabilitadas, sin claims de aplicación
y con tombstones `active:false`. Los positivos de `admin`, `manager` y `builder` se ejecutan en
Firebase Auth Emulator. Cualquier reactivación productiva o creación de una identidad administrativa
requiere credenciales no compartidas, manifiesto exacto y una autorización separada.

### Backend y reglas

Quedaron activas nueve Functions Gen 2, Node 22, en `europe-west1`, todas con el hash remoto
`51ca9e5912b808e7e4a8d3fd908d47d355662ef9`:

- `cleanupOldProjects`
- `consumeInvitation`
- `createAssignedProject`
- `createManagerInvitation`
- `extractJobsFromExcel`
- `listAssignableBuilders`
- `reviewInvoice`
- `submitInvoice`
- `validateInvitationCode`

Las Functions inseguras heredadas `setUserRole` y `ensureBuilderRole` no existen en el inventario
activo. Firestore Rules y Storage Rules se publicaron coordinadamente con el contrato de grant
server-only. Artifact Registry quedó configurado para retirar imágenes de compilación con más de un
día; Git y el manifiesto de release son la fuente duradera de reconstrucción.

### Smokes posteriores

- Una lectura Firestore sin autenticación respondió `403 PERMISSION_DENIED`.
- `listAssignableBuilders` sin autenticación respondió `401 UNAUTHENTICATED`.
- Un código inválido en `validateInvitationCode` respondió de forma segura con `valid:false`.
- `/auth` cargó con el formulario esperado; `/admins` anónimo redirigió a `/auth`; `/` cargó la SPA.

No se usaron las cuentas QA deshabilitadas para un positivo productivo. La matriz completa de roles
se validó con Emulator/E2E y el smoke remoto se limitó deliberadamente a comprobaciones negativas y
públicas sin crear datos persistentes.

## Orden coordinado aplicado

1. Congelar altas y mantener deshabilitadas las identidades QA compartidas.
2. Inventariar Auth y preparar el manifiesto exacto de cada usuario activo.
3. Crear/rotar primero los grants activos, verificar Auth↔Firestore y revocar sesiones anteriores.
4. Confirmar dos pares activos exactos, tres tombstones QA y cero diferencias.
5. Desplegar desde el candidato revisado Functions y Rules v4; verificar 9/9 y ausencia de las dos
   Functions inseguras.
6. Publicar el cliente, exigir sesiones nuevas y ejecutar CI, smokes y revisión del inventario.
7. Corregir la carrera de logout detectada por el CI de `main`, repetir todo el gate y publicar la
   estabilización por PR #4.

Este orden es también el mínimo para cambios futuros: grants antes de Rules que los exigen. Nunca se
publican Rules basadas en grants si un usuario activo autorizado todavía carece de su par exacto.

## Evidencia QA final

- Node `22.23.2` y JDK `21`.
- Firebase Emulator: 18 archivos, 133/133 pruebas.
- Playwright Firebase: 12/12, cero retries; onboarding burn-in 5/5.
- Concurrencia/sesión focal: 6/6; Functions unit 10/10; provider guard 9/9; seguridad de roles 14/14
  en el SHA de aplicación;
  CI/Vite 4/4; Storage helper 3/3; OCR 3/3.
- El tooling administrativo endurecido después del corte tiene 23/23 pruebas locales; su publicación
  y CI son una revisión separada y no se atribuyen al SHA de aplicación de esta acta.
- Typecheck, build de Functions, build cliente y lint aprobados. Quedan siete warnings históricos de
  Fast Refresh y el aviso conocido de chunk grande; no hubo errores.
- Auditoría del cliente: cero vulnerabilidades runtime. Functions conserva seis alertas moderadas
  transitivas y cero altas/críticas; no se aplicó el downgrade incompatible propuesto por `--force`.

## App Check

La site key oficial está configurada en Vercel y el cliente reCAPTCHA Enterprise está desplegado sin
versionar ni imprimir su valor. Functions conserva `ENFORCE_APP_CHECK=false`: App Check está en
observación, no en enforcement.

La observación del release vigente comenzó el 2026-08-31 13:55 America/Bogota. No se considera
enforcement antes del 2026-09-07 13:55 y, aun después, requiere métricas legítimas, pruebas de token
válido/ausente/inválido y autorización productiva separada.

## Rollback seguro

- No restaurar invitaciones v1-v3, `setUserRole`, `ensureBuilderRole` ni Rules basadas solo en
  `role`; reautorizarían tokens viejos o grants revocados.
- Mantener siempre Rules con grants y corregir Functions hacia adelante. Una versión anterior del
  cliente solo es elegible si respeta el mismo contrato v4.
- No borrar grants ni reactivar tombstones. Una revocación iniciada es monotónica; restaurar acceso
  es una asignación nueva con grant rotado y autorización explícita.
- No reactivar las identidades QA compartidas como rollback. Un positivo productivo futuro exige
  identidades controladas individualmente y autorización separada.
- El bucket y su región son permanentes. Un rollback funcional no elimina datos, usuarios, bucket ni
  proyecto Firebase.

## Gate de retirada de staging

El reloj anterior del 2026-08-29 quedó invalidado por el corte de seguridad posterior. La nueva
observación comenzó el 2026-08-31 13:55 America/Bogota; el primer momento elegible es el
2026-09-07 13:55, siempre que se cumpla todo lo siguiente:

- [ ] Producción mantiene 9/9 Functions activas, Rules vigentes y smokes limpios.
- [ ] No hay errores nuevos, diferencias Auth↔Firestore ni consumo inesperado.
- [ ] `jobsitejedi-staging` mantiene el inventario esperado y no contiene un recurso que deba
  respaldarse o migrarse.
- [ ] Se conserva evidencia del release, configuración recuperable y plan de reversión.
- [ ] El operador confirma explícitamente el borrado destructivo en ese momento.

Solo entonces se elimina exactamente `jobsitejedi-staging`, se comprueba que deje de facturar y se
retira su alias. `jobsitejedi` nunca se incluye en la operación destructiva.

## Registro histórico del 2026-08-29

El despliegue inicial del 2026-08-29, sus inventarios de tres usuarios, huellas locales y orden
Rules→Functions pertenecen a una versión anterior al contrato de grants v4. Se conservan en el
historial Git únicamente como evidencia histórica: no son baseline de rollback ni instrucciones
operativas vigentes. El corte del 2026-08-31 reemplaza íntegramente ese manifiesto y reinicia los
relojes de observación.
