# Release 2026-08-28 — Gate de CI

## Alcance

- Reconciliar `BRIEF.md` y los estados vigentes de `tasks.md`.
- Añadir GitHub Actions para contratos, typecheck, lint, builds, Firebase Emulator Suite y E2E.
- Hacer que el servidor Playwright arranque de forma compatible con Windows y Linux.
- Corregir cuatro aserciones E2E ambiguas del selector de proyecto.

Este release no modifica código de runtime, datos, reglas, Cloud Functions desplegadas, usuarios,
claims ni configuración remota de Firebase. El `push` a `main` sí crea un deployment automático de
Vercel con el mismo runtime del release anterior.

## Evidencia previa

- Contrato del workflow: 3/3.
- `npm ci` desde cero para raíz y Functions: aprobado con el lockfile multiplataforma.
- Typecheck y builds frontend/Functions: aprobados.
- ESLint: 0 errores; 7 warnings preexistentes de Fast Refresh.
- Firebase Emulator Suite: 16 archivos, 65/65 pruebas.
- Playwright contra emuladores: 8/8 recorridos E2E.
- Playwright queda limitado a 2 workers y sin reintentos; las aserciones asíncronas tienen un
  timeout acotado de 15 segundos para no convertir la aceptación funcional en carga accidental.
- Revisión de seguridad: sin hallazgos críticos, secretos ni comandos de despliegue en el workflow.

## Validación posterior

1. Confirmar en GitHub Actions que pasen `Quality and contracts` y
   `Firebase emulators and E2E`.
2. Confirmar que Vercel complete el deployment de `main`.
3. Cargar directamente `/auth` en producción y verificar que la SPA se muestre sin errores Firebase.

## Rollback

Si falla el gate o aparece una regresión:

1. No modificar datos, usuarios, claims, reglas ni Functions; este release no los cambia.
2. Revertir el commit de este release con `git revert <commit>` y publicar el revert solo con
   confirmación del operador.
3. Si el frontend publicado falla, promover en Vercel el deployment estable asociado a `4d1f160`,
   siguiendo `docs/vercel-deployment.md`.
4. Repetir la carga directa de `/auth` y documentar el incidente antes de reintentar.
