# Acta de release productiva — 2026-08-31

Estado: release de aplicación desplegada y verificada. App Check permanece en observación y la
retirada de staging continúa pendiente; ninguno de esos dos gates está implícitamente autorizado.

## Identidad de la release

- Contrato de autorización/invitaciones v4: PR [#3](https://github.com/andresleosan/jobsitejedi/pull/3),
  merge `aaf8aad42ac009a46eacf03ee33c3419aeaa2210`.
- Corrección de solicitudes obsoletas durante logout/navegación: PR
  [#4](https://github.com/andresleosan/jobsitejedi/pull/4), candidato
  `557caac763c8ae67ba3766d2e4958f9662afc70f` y release de aplicación
  `864335ecf4e497221469e3462a623c5211e5846e`.
- CI del candidato: [run 33432508491](https://github.com/andresleosan/jobsitejedi/actions/runs/33432508491),
  dos jobs verdes.
- CI exacto del merge de `main`:
  [run 33433050837](https://github.com/andresleosan/jobsitejedi/actions/runs/33433050837), dos jobs
  verdes y evidencia QA inmutable.
- Deployment Vercel de la aplicación: `HVMXDbSrwh8XYaXram1b99M7N3Vx`, verificado `Ready`,
  `Production` y `Current` para la release; URL pública
  [jobsitejedi.vercel.app](https://jobsitejedi.vercel.app/).

El primer CI de `main` tras PR #3, run `33427585294`, detectó correctamente una consulta que podía
terminar después del logout y producir `console.error`. No se relajó el fixture: T-034 incorporó
propiedad de sesión y generaciones de solicitud, repitió las pruebas y cerró el fallo en PR #4.

## Alcance desplegado

- Jerarquía única `admin > manager > builder`; admin puede invitar manager/builder, manager solo
  builder y el alta de admin permanece exclusivamente administrativa.
- Invitaciones v4 resistentes a pre-hijacking, reintentos e idempotencia; v1-v3 fallan cerrado.
- Grants server-only exactos para Rules, Storage y callables, con revocación monotónica por tombstone.
- Asignación manager→builder→proyecto→job y esquemas/transiciones de integridad reforzados.
- Facturas en cuarentena, validación por bytes, recodificación server-side y nombres canónicos.
- Vite 8.2.2 en loopback, CI ligado al SHA y Playwright sin retries ni errores de consola tolerados.
- Nueve Functions v4 y Firestore/Storage Rules desplegadas; `setUserRole` y `ensureBuilderRole`
  ausentes del inventario remoto.
- Cliente App Check reCAPTCHA Enterprise desplegado con clave oficial; Functions conserva
  `ENFORCE_APP_CHECK=false` durante observación.

## Evidencia QA final

- Runtime local: Node 22.23.2 y JDK 21.
- Concurrencia/sesión focal: 6/6; onboarding burn-in: 5/5.
- Firebase Emulator: 18 archivos, 133/133 pruebas.
- Playwright Firebase: 12/12, cero retries, `pageerror` y `console.error` bloqueantes.
- Functions unit 10/10; provider guard 9/9; operaciones de rol 14/14 en el SHA de aplicación;
  CI/Vite 4/4; OCR 3/3;
  Storage helper 3/3.
- El endurecimiento administrativo posterior (challenge/CAS/provider/revocación) tiene 23/23 pruebas
  locales y se publica como una revisión operativa separada; no se atribuye al run ni al SHA de
  aplicación indicados en esta acta.
- Typecheck, lint, build Functions y build cliente aprobados. ESLint conserva siete warnings
  históricos de Fast Refresh; Vite conserva el aviso conocido de chunk grande, sin error de build.
- Build productivo Vercel aprobó el validador de la site key oficial sin exponer su valor.
- Autocrítica de seguridad posterior: sin hallazgos críticos, altos o medios bloqueantes. El riesgo
  bajo residual es cobertura adicional de montaje para logout fallido/solicitudes fuera de orden;
  el contrato ya tiene pruebas unitarias y E2E de la regresión observada.
- Auditoría runtime del cliente: 0 vulnerabilidades. Functions: 6 moderadas transitivas y 0
  altas/críticas; no se aplicó el downgrade incompatible sugerido por `npm audit fix --force`.

## Verificación productiva

El inventario agregado posterior evitó datos personales y valores de grants:

- 5 usuarios Auth en total.
- 2 usuarios activos autorizados con grants exactos.
- 3 identidades QA compartidas deshabilitadas, sin claims de aplicación y con tombstones inactivos.
- 5 documentos grant en total: 2 activos y 3 tombstones; 0 diferencias Auth↔Firestore.
- 9/9 Functions activas con el mismo hash remoto; las dos Functions inseguras heredadas no existen.
- Rules Firestore y Storage publicadas con el contrato v4.
- Firestore anónimo negó con `403`; un callable protegido negó con `401`; una invitación inválida
  respondió de forma segura; `/auth`, `/` y la redirección anónima de `/admins` funcionaron.

El recibo agregado reproducible está en
[`evidence/production-auth-cutover-20260831.json`](evidence/production-auth-cutover-20260831.json),
Git blob `8d4ea8364b81305b78e10e1517a07e55917ce532`.

No se realizó backfill ni migración de proyectos, jobs o archivos. La única reconciliación remota fue
la autorización exacta necesaria para los dos usuarios activos y los tres tombstones QA.

## Estado de las identidades QA

Los tres perfiles existen y se prueban con rol `admin`, `manager` y `builder` en Firebase Auth
Emulator. Sus homólogos compartidos de producción no se usan para QA: permanecen deshabilitados y no
tienen privilegios activos. Esto evita publicar credenciales compartidas capaces de operar datos
reales. Reactivarlos exige una decisión productiva separada, credenciales individuales y un nuevo
grant; esta acta no lo autoriza.

## Gates que siguen abiertos

1. App Check/T-035: observar desde el 2026-08-31 13:55 America/Bogota. No habilitar enforcement antes
   del 2026-09-07 13:55, ni sin métricas legítimas, pruebas de tokens y autorización separada.
2. Staging: no eliminar `jobsitejedi-staging` antes del 2026-09-07 13:55. Repetir inventario, smokes
   y costo, verificar respaldo/rollback y solicitar confirmación destructiva en ese momento.
3. Lifecycle de cuarentena: sigue requiriendo inventario y autorización propia. La limpieza de
   imágenes de compilación de Artifact Registry sí quedó configurada a un día.
4. Dependencias Functions: seguir la corrección upstream de las seis moderadas transitivas; no usar
   `--force` mientras implique un downgrade incompatible.
5. Rendimiento/documentación modular: T-030 y T-031 continúan como mejoras P2 y no forman parte del
   gate de seguridad ya desplegado.

## Rollback

El procedimiento operativo vive en `docs/firebase-consolidation-operations.md`. En particular, no
se permite volver a Rules/Functions basadas solo en `role`, restaurar invitaciones v1-v3, borrar
tombstones ni reactivar identidades QA como rollback. La recuperación conserva grants v4 y corrige
hacia adelante; una restauración de privilegio es una nueva operación autorizada con grant rotado.
