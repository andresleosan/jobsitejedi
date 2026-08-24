# Stack y arquitectura — BuildTrack Pro

Estado: `aceptado por el operador en checkpoint A2.1`

Fecha: `2026-08-24`

## Producto

BuildTrack Pro es una aplicación de gestión de proyectos de construcción para los roles
`manager` y `builder`. El flujo crítico es:

`autenticación → dashboard por rol → proyectos/trabajos → tiempo/materiales → archivos y reportes`

## Clasificación provisional

**Nivel 3.** La aplicación combina autenticación, autorización por roles,
datos multiusuario, archivos privados, tiempo real, facturas, procesamiento serverless,
reglas de seguridad y más de un proveedor activo. Esta clasificación exige pruebas de
contrato, reglas, integración y E2E antes de una release.

La clasificación fue confirmada por el operador el `2026-08-24`.

## Stack objetivo propuesto

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Activo |
| UI | Tailwind CSS + shadcn/Radix + Recharts | Activo |
| Routing | React Router DOM | Activo |
| Validación | Zod + React Hook Form | Activo |
| Estado/cache | TanStack Query, hooks locales | Parcial |
| Auth | Firebase Authentication | En construcción |
| Datos | Cloud Firestore | Pendiente |
| Archivos | Firebase Storage privado | Pendiente |
| Backend privilegiado | Firebase Cloud Functions | Scaffold |
| Testing | Vitest + Playwright | Parcial |
| Infraestructura local | Firebase Emulator Suite | Configurada, no estabilizada |
| Proveedor legado | Supabase | Retirada progresiva |

## Decisión de proveedor

Firebase queda adoptado como proveedor único de runtime para evitar la sesión dividida entre
Firebase Auth y Supabase Database/Storage. La decisión está registrada en el ADR
`docs/adr/ADR-001-proveedor-de-datos.md`.

No se agregará una nueva funcionalidad que dependa de ambos proveedores. Durante la
migración podrán coexistir artefactos históricos, pero no una nueva ruta híbrida de negocio.

## Arquitectura objetivo

- `src/lib/firebase/auth.ts`: sesión, registro, login, logout y claims de rol.
- `src/lib/firebase/repositories/`: acceso tipado a Firestore por dominio.
- `src/lib/firebase/storage.ts`: upload, descarga, thumbnails y URLs temporales.
- `functions/src/`: invitaciones, claims, procesamiento privilegiado y tareas programadas.
- `firestore.rules` y `storage.rules`: autorización real, independiente de React.
- Las pantallas consumen hooks/repositorios; no construyen consultas Firestore directamente.
- Firestore conserva rutas de archivos, no URLs públicas persistentes.

## Seguridad y secretos

- El cliente solo usa variables `VITE_FIREBASE_*` públicas del SDK.
- No se permiten service accounts, claves privadas ni secretos de Functions en el frontend.
- `.env` debe permanecer fuera de Git; las credenciales históricas versionadas deben rotarse.
- Toda regla de acceso se prueba para anónimo, propietario, usuario ajeno y manager.
- Las funciones validan rol e input; el frontend no es frontera de seguridad.

## Testing y calidad

Comandos objetivo:

```text
npm.cmd run build
node_modules/.bin/tsc.cmd -p tsconfig.app.json --noEmit
npm.cmd run lint
npm.cmd run test:storage
npm.cmd run test:firebase
npm.cmd run test:provider-guard
npm.cmd run test:e2e:firebase
npm.cmd --prefix functions run build
```

La suite Firebase debe ejecutarse contra emuladores. La suite E2E debe cubrir como mínimo
login, roles, proyectos, trabajos, fotos, inventario, facturas y reportes.

## Migración

Se usará migración incremental por verticales:

1. Auth y roles.
2. Reglas y contratos Firestore.
3. Proyectos, trabajos y tiempo.
4. Storage y fotos.
5. Inventario, solicitudes, facturas y reportes.
6. Retirada de referencias runtime a Supabase.

No se importan datos históricos desde Supabase sin un plan separado de datos, backup,
validación y rollback. No se aplican migraciones destructivas en producción desde este
backlog.

## Despliegue y operación

- Desarrollo: Firebase Emulator Suite.
- Validación: staging aislado.
- Producción: solo con backup cuando aplique, rollback documentado y confirmación explícita.
- Antes de usar Functions con APIs externas se debe definir límite de costo, timeout,
  reintentos y alerta presupuestaria.

## Checkpoint A2.1

Confirmado explícitamente por el operador:

- [x] Firebase como proveedor único objetivo.
- [x] Clasificación Nivel 3.
- [x] Migración incremental sin nueva ruta híbrida.
- [x] Testing con Emulator Suite + Vitest + Playwright.
