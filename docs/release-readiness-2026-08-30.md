# Preparación de release — 2026-08-30

Estado: evidencia histórica superada por T-033; producción contenida y despliegue bloqueado.

> La suite de esta fecha no cubría el pre-hijacking de invitaciones. El gate debe repetirse sobre el
> contrato v4 de 2026-08-31; sus conteos no autorizan commit, CI ni despliegue del working tree actual.

## Evidencia local vigente — 2026-08-31

- Runtime comprobado: Node 22.23.2 y JDK 21.
- Firebase Emulator final: 17 archivos, 127/127 pruebas. Incluye token viejo, rotación conjunta,
  grant ausente/inactivo/distinto y tombstone que no puede reactivarse.
- Playwright Firebase final: 12/12; onboarding focal adicional 1/1; cero reintentos aceptados y el
  fixture falla ante `pageerror` o `console.error`.
- Functions unit 10/10; provider guard 9/9; guard operativo 5/5; CI/Vite 4/4; OCR 3/3; helper Storage
  3/3; typecheck, Functions build, cliente development build y ESLint aprobados. ESLint mantiene solo
  siete warnings históricos de Fast Refresh.
- Auditoría runtime cliente: 0 vulnerabilidades. Functions: seis moderadas transitivas en
  `uuid`/Google Storage, 0 altas/críticas; el único fix propuesto fuerza un downgrade incompatible de
  `firebase-admin`, por lo que no se aplicó.
- Autocrítica de seguridad: no queda vía crítica/alta confirmada en invitaciones, claims o grants.
- `npm run build` de producción local falla cerrado porque `.env` conserva un placeholder para
  `VITE_FIREBASE_APPCHECK_SITE_KEY`. La variable existe en Vercel para Production/Preview, sin revelar
  su valor, pero el build remoto del SHA final debe demostrar que el valor real pasa el validador.

## Alcance preparado

- Jerarquía única `admin > manager > builder`; admin invita manager/builder y el alta de admin queda
  restringida al runbook administrativo.
- `admin@admin.com` verificado con claim `admin` exclusivamente en Auth Emulator.
- Asignación de proyectos y transiciones de datos protegidas por Functions y Rules.
- Facturas en cuarentena, validación por bytes, recodificación server-side y nombres canónicos.
- Vite 8.2.2 en loopback, CI ligado a SHA y artefactos Playwright.
- App Check reCAPTCHA Enterprise preparado con `ENFORCE_APP_CHECK=false` para observación.

## Evidencia local

- Runtime: Node 22.23.2 y JDK 21.
- TypeScript y builds frontend/Functions aprobados; ESLint 0 errores y 7 warnings heredados de
  Fast Refresh.
- Functions unit: 7/7; Storage helper: 3/3; OCR: 3/3; provider guard: 8/8; CI/Vite: 4/4.
- Firebase Emulator: 17 archivos, 81/81 pruebas.
- Playwright Firebase: 11/11, cero reintentos y sin `pageerror`/`console.error`.
- Web Vitals p75: desktop LCP 116 ms, INP 16 ms, CLS 0; mobile LCP 104 ms, INP 16 ms, CLS 0.
- Auditoría runtime cliente: 0 vulnerabilidades. Functions: 6 moderadas transitivas, 0 altas y 0
  críticas; npm solo propone un downgrade incompatible, por lo que no se aplicó `--force`.

## Bloqueos antes de producción

0. Obtener un build de producción exitoso con la App Check site key oficial; no sustituirlo por el
   build development. Las tres cuentas QA remotas permanecen deshabilitadas.
1. Crear un commit revisable y ejecutar GitHub Actions sobre ese SHA exacto. El árbol actual aún no
   tiene un SHA de release y por eso T-028 no puede aprobarse definitivamente.
2. Revisar/aceptar explícitamente las seis alertas moderadas transitivas de Functions o actualizar
   cuando Google publique una cadena compatible.
3. Rotar cualquier credencial sensible que pudiera haber aparecido en una sesión DEBUG anterior;
   el runner ya elimina `DEBUG`, pero la prevención no reemplaza la rotación.
4. Repetir inventario productivo de solo lectura y preparar el backfill exacto de grants para cada
   usuario autorizado. Desplegar Rules antes de ese backfill bloquearía a todos los roles.
5. Registrar App Check y la site key en el hosting, inicialmente en observación. El enforcement y
   el lifecycle de cuarentena requieren autorizaciones posteriores separadas.
6. Decidir por separado si `admin@admin.com` debe existir también en producción. La cuenta QA local
   no se copia; crear identidad o cambiar claims productivos es una mutación independiente.

## Secuencia propuesta

1. Con autorización no productiva: crear commit, publicar rama/PR y esperar los dos jobs de CI.
2. Corregir cualquier fallo y congelar el SHA candidato.
3. Ejecutar preflight productivo de solo lectura, preparar manifiesto de grants, backup aplicable y
   checklist de rollback.
4. Con autorización productiva propia, crear/rotar grants mientras la versión antigua sigue activa y
   verificar Auth↔Firestore sin imprimir valores.
5. Solicitar autorización explícita para el despliegue del SHA y enumerar exactamente Rules,
   Functions y frontend. Desplegar el contrato coordinado en ventana de mantenimiento, exigir login
   nuevo, ejecutar smokes negativos/positivos y monitorear errores/costo. App Check sigue observación.
6. Solicitar otra autorización para enforcement de App Check después de al menos siete días de
   métricas legítimas, y otra distinta para cualquier borrado de staging o lifecycle destructivo.

Rollback operativo detallado: `docs/firebase-consolidation-operations.md`,
`docs/app-check-rollout.md` y los runbooks de migración en `docs/`.
