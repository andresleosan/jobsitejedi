# Backlog de evolución — BuildTrack Pro

Fecha de planificación: `2026-08-24`

## Estado de partida

- Proyecto web Nivel 3 provisional: React/Vite, Firebase Auth en construcción,
  Supabase todavía activo para datos y Storage, funciones serverless y roles.
- `npm run build`: pasa.
- `npm run lint`: falla con 143 errores y 32 warnings.
- `tsc --noEmit`: falla por import duplicado de `storage`.
- `test:storage`: 3/3 pasa.
- `test:firebase`: 6 tests fallan; emulador Auth no levantado y proyecto configurado
  distinto al esperado.
- `test:provider-guard`: falla con 275 referencias runtime a Supabase.
- `test:e2e:firebase`: no tiene pruebas.
- No se autoriza despliegue, migración de producción ni borrado de datos desde estas tareas.

## Decisión de producto y arquitectura

La prioridad se ordena por el usuario que más sufre hoy —builders y managers que no
pueden completar de forma confiable el flujo autenticación → datos → archivos— y por
riesgo operativo. La migración de proveedor tiene precedencia sobre mejoras visuales:
si no se resuelve, cualquier feature nueva puede quedar construida sobre una sesión o
reglas incompatibles.

La ruta recomendada es completar la migración aprobada a Firebase. Si el operador elige
mantener Supabase, se debe crear una ruta alternativa explícita y retirar las tareas
Firebase que ya no apliquen.

## Estados

`pendiente` → `en-progreso` → `revisión` → `aprobada` → `desplegada`

Una tarea solo puede pasar a `revisión` después de ejecutar sus pruebas. Las tareas que
toquen producción necesitan confirmación explícita del operador.

## Fase 0 — Decisión y línea base

### T-001 — Confirmar proveedor objetivo y nivel del proyecto

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** —
- Confirmar Firebase como proveedor objetivo o decidir reversión temporal a Supabase.
- Crear `STACK.md` con el stack real, clasificación Nivel 3 provisional, estrategia de
  testing, secretos, emuladores y límites de despliegue.
- Registrar la decisión en un ADR si se mantiene la migración Firebase, porque cambiar
  proveedor es costoso de revertir.
- **Aceptación:** decisión aprobada por el operador; no se implementa una ruta híbrida
  nueva después de esta tarea.

### T-002 — Establecer baseline reproducible de calidad

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-001
- Documentar comandos oficiales para frontend, Functions, TypeScript, lint, tests de
  emulador y E2E.
- Corregir la configuración del proyecto Firebase local para que `.env.example`,
  `.firebaserc`, tests y emuladores usen el mismo `projectId`.
- Hacer que la ausencia del emulador produzca un mensaje accionable, no fallos opacos.
- **Aceptación:** una ejecución documentada reproduce el baseline y distingue bloqueo de
  infraestructura de fallo de código.
- **Evidencia 2026-08-24:**
  - `node_modules/.bin/vitest.cmd run tests/firebase/runner-config.test.ts tests/firebase/infrastructure.test.ts`
    → 2 archivos, 5 tests aprobados.
  - `npm.cmd run test:firebase:emulator` con configuración temporal local
    → 5 archivos, 12 tests aprobados; Emulator Suite inició y se apagó correctamente.
  - `npm.cmd run build` → aprobado.
  - `npm.cmd run typecheck` → sigue fallando por el import duplicado de `storage` en
    `RubbishCollectionDialog.tsx`; queda asignado a T-014 y no se oculta.

## Fase 1 — Autenticación y autorización

### T-003 — Completar roles Firebase y contrato de sesión

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-001, T-002
- Asignar el claim `builder` durante el registro permitido.
- Implementar Function protegida para asignación de roles `manager`/`builder`.
- La persistencia y consumo de invitaciones queda deliberadamente en T-009, junto con
  el modelo Firestore y su idempotencia; no se crea una invitación efímera ni insegura en
  esta tarea.
- Hacer que `useAuth`, `Dashboard`, `Builders` y `Managers` compartan el mismo contrato
  de usuario, sesión y rol.
- No confiar en el rol enviado desde el cliente.
- **Pruebas:** registro builder, login, logout, claims y acceso denegado sin rol.
- **Aceptación:** el usuario registrado llega a su dashboard correcto y los tests Auth
  pasan contra el emulador.
- **Evidencia 2026-08-24:**
  - `npm.cmd --prefix functions run build` → aprobado.
  - `npm.cmd run build` → aprobado.
  - `npm.cmd run test:firebase:emulator` → 5 archivos, 13 tests aprobados con Auth +
    Functions Emulator; incluye claim builder y rechazo de escalada builder→manager.
  - ESLint focalizado sobre Auth, cliente Functions, backend Functions y pruebas → aprobado;
    `git diff --check` → aprobado.
  - Revisión de seguridad: las Functions exigen autenticación, validan payloads y el
    cambio de rol exige claim manager; el cliente no puede autoasignarse manager.

### T-004 — Implementar reglas mínimas de Firestore

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-003
- Reemplazar el `deny all` de `firestore.rules` por reglas para `users`, `projects`,
  `jobs`, `jobCompletions`, `timeTracking` e invitaciones.
- Cubrir anónimo, builder propietario, builder ajeno y manager.
- Añadir índices solo para consultas reales de repositorios.
- **Pruebas:** `@firebase/rules-unit-testing` para cada límite de autorización.
- **Aceptación:** ningún test de reglas crítico queda sin cobertura y el builder no puede
  leer o editar registros de otro usuario.
- **Evidencia 2026-08-24:**
  - `npm.cmd run test:firebase:emulator` → 6 archivos, 18 tests aprobados con Auth,
    Firestore y Functions Emulator.
  - Cobertura verificada: anónimo, propietario builder, builder ajeno, manager, claims
    inmutables, jobs, completados, time tracking e invitaciones sin escritura directa.
  - ESLint focalizado y `git diff --check` → aprobados.
  - `npm.cmd run build` → aprobado. `npm.cmd run typecheck` mantiene el fallo previo de
    import duplicado en `RubbishCollectionDialog.tsx`, asignado a T-014.

## Fase 2 — Primera vertical funcional Firebase

### T-005 — Crear repositorios tipados de usuarios, proyectos y trabajos

- **Prioridad:** P0 · **Estado:** en-progreso · **Depende de:** T-004
- Crear repositorios bajo `src/lib/firebase/repositories/`.
- Sacar consultas y escrituras de `ProjectList`, `CreateProjectDialog`,
  `EditProjectDialog`, `ManagerJobsList` y `ProjectDetails`.
- Usar IDs explícitos, timestamps del servidor y operaciones batch cuando corresponda.
- **Pruebas:** CRUD de proyecto/trabajo, visibilidad por rol y listeners sin duplicados.
- **Aceptación:** la vertical login → dashboard → proyecto → trabajo funciona sin
  imports runtime de Supabase en esos módulos.
- **Avance 2026-08-24:**
  - Añadido `src/lib/firebase/repositories/projects.ts` con contrato camelCase,
    propietario derivado de Auth, timestamps de servidor, CRUD tipado y consultas
    condicionadas por rol.
  - Firestore Emulator conectado en el cliente y prueba CRUD de proyecto añadida.
  - `npm.cmd run test:firebase:emulator` → 7 archivos, 19 tests aprobados.
  - `ProjectList`, `CreateProjectDialog` y `EditProjectDialog` ya no tienen imports
    runtime de Supabase y consumen el repositorio Firebase.
  - Build y ESLint focalizado → aprobados; el typecheck global quedó resuelto al corregir
    el import duplicado de `storage` en `RubbishCollectionDialog.tsx`.
  - La lista y los diálogos ya están conectados; las métricas quedan fuera hasta migrar
    jobs, tiempo e invoices como contratos Firebase, evitando una pantalla híbrida.
  - Añadido repositorio de jobs con `projectId`, `builderId`, estado y secciones; creación
    y listado básico ya consumen Firebase y no Supabase.
  - Las fotos y el envío de completados permanecen explícitamente fuera de este corte y
    quedan para T-008/T-006.
  - Suite del emulador tras la migración de jobs → 8 archivos, 20 tests aprobados.

### T-006 — Migrar seguimiento de tiempo y transiciones de trabajo

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-005
- Implementar repositorio de `timeTracking` y estados permitidos de trabajo.
- Evitar escrituras parciales al iniciar, cambiar o detener una jornada.
- Validar que un builder solo modifique sus operaciones autorizadas.
- **Pruebas:** inicio/cierre, cambio de proyecto, estados inválidos y acceso cruzado.
- **Aceptación:** flujo probado con emulador y sin consultas directas a Supabase.
- **Avance 2026-08-24:**
  - Añadido `src/lib/firebase/repositories/timeTracking.ts` con jornada activa única,
    inicio, cierre y cambio de proyecto en batch.
  - La autorización usa `builderId` derivado de Auth; las reglas bloquean acceso cruzado.
  - Suite Auth + Firestore + Functions Emulator → 9 archivos, 23 tests aprobados.
  - `BuilderDashboard` y `TimeTrackingCard` ya consumen el repositorio Firebase para
    proyectos, jornada activa, clock-in, clock-out y cambio de proyecto; no tienen imports
    directos de Supabase.
  - `/builders` ya valida sesión y rol con Firebase antes de montar el dashboard; la ruta
    dejó de depender de la pantalla Supabase antigua.
  - Migrado `ChangeProjectDialog` a operaciones Firebase por lotes: cierre de jornada,
    registro de viaje, llegada, apertura del proyecto destino y `projectSwitches` protegido
    por `builderId`.
  - Los reportes históricos, materiales, perfil y facturación quedan fuera de esta vertical
    y siguen asignados a sus tareas específicas.

## Fase 3 — Archivos privados

### T-007 — Implementar Firebase Storage privado

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-003, T-004
- Crear helpers tipados para upload, descarga, URL temporal y thumbnails.
- Implementar `storage.rules` por rol, propietario y primer segmento de ruta.
- Mantener rutas en Firestore; no persistir URLs públicas.
- Cubrir `job-photos`, `job-completion-photos`, `daily-report-photos`, `invoices`,
  `documents`, materiales, residuos y notas de voz.
- **Pruebas:** anónimo, propietario, usuario ajeno, builder y manager.
- **Aceptación:** archivos privados no son accesibles sin autenticación y las reglas
  pasan en el emulador.
- **Evidencia 2026-08-24:**
  - Añadido `src/lib/firebase/storage.ts` con rutas normalizadas, upload, descarga en
    memoria, object URLs temporales, borrado y rutas de thumbnails; no expone URLs públicas.
  - `storage.rules` cubre jobs, reportes diarios, invoices, documents, materiales, residuos
    y notas de voz, con propietario/manager, límite de 10 MB y MIME permitido.
  - `npm.cmd run test:firebase:emulator` con Storage Emulator → 11 archivos, 30 tests
    aprobados; las pruebas cubren anónimo, propietario, acceso cruzado, manager, MIME
    inválido y raíces no permitidas.
  - `npm.cmd run typecheck`, ESLint focalizado, `git diff --check` y `npm.cmd run build`
    → aprobados. El warning de bundle grande permanece asignado a T-016.

### T-008 — Migrar la primera vertical de fotos

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-005, T-007
- Migrar creación, edición, revisión y completado de trabajos a Firebase Storage.
- Mantener miniaturas, descarga y manejo de errores.
- Verificar que las rutas antiguas no se conviertan accidentalmente en URLs públicas.
- **Aceptación:** E2E de carga, vista, descarga y rechazo de foto ajena.

## Fase 4 — Funciones y dominios restantes

### T-009 — Implementar Cloud Functions privilegiadas

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-003, T-004
- Implementar invitaciones, asignación de roles, procesamiento de facturas,
  extracción de Excel y limpieza programada.
- Validar entradas, rol, rutas, timeouts, reintentos finitos y errores seguros.
- No conectar APIs de pago sin confirmación de costo y configuración de límites.
- **Pruebas:** manager permitido, builder rechazado, payload inválido e idempotencia.
- **Aceptación:** `functions` tiene tests ejecutables y ningún secreto aparece en logs.

### T-010 — Migrar inventario, herramientas y solicitudes

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-005, T-009
- Crear repositorios para materiales, uso, entregas, herramientas, checkouts y residuos.
- Cubrir transiciones de estado, cantidades y operaciones manager-only.
- Reemplazar listeners `postgres_changes` por listeners Firestore con cleanup.
- **Aceptación:** escenarios builder/manager pasan con reglas y repositorios tipados.

### T-011 — Migrar facturas, reportes y evaluaciones de riesgo

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-007, T-009, T-010
- Migrar facturas, proveedores, extracción, reportes diarios, firmas y documentos.
- Revisar especialmente que `documents` no exponga archivos de otros usuarios y que la
  ruta/bucket de evaluaciones de riesgo sea coherente.
- **Aceptación:** archivos, datos financieros y firmas tienen tests de autorización y E2E.

## Fase 5 — Retirada de Supabase

### T-012 — Eliminar dependencias runtime de Supabase

- **Prioridad:** P0 · **Estado:** pendiente · **Depende de:** T-005, T-006, T-007, T-008,
  T-009, T-010, T-011
- Eliminar imports runtime de Supabase en `src`.
- Eliminar cliente, tipos y dependencia npm solo cuando no haya consumidores.
- Mantener migraciones históricas como evidencia hasta decidir su limpieza.
- **Pruebas:** `npm run test:provider-guard` debe pasar con cero referencias.
- **Aceptación:** `rg` y el guard confirman que no existe una ruta híbrida accidental.

### T-013 — Retirar o aislar infraestructura Supabase antigua

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-012
- Documentar qué migraciones se conservan como historial y qué carpetas quedan fuera del
  runtime.
- Si se aplica la migración Storage anterior, hacerlo primero en staging con backup
  verificado, rollback documentado y confirmación explícita del operador.
- Validar políticas efectivas en `pg_policies` antes de retirar el proveedor.
- **Aceptación:** no se ejecuta ninguna acción destructiva en producción sin checkpoint.

## Fase 6 — Calidad, seguridad y rendimiento

### T-014 — Cerrar TypeScript y lint por lotes

- **Prioridad:** P1 · **Estado:** en-progreso · **Depende de:** T-012
- Corregir primero errores de compilación y después dividir la deuda de `any` por dominio:
  auth, proyectos/trabajos, inventario, finanzas y UI.
- Resolver dependencias reales de `useEffect`; no silenciar reglas globalmente.
- **Aceptación:** `tsc --noEmit` y `npm run lint` pasan sin desactivar reglas de seguridad.
- **Avance 2026-08-24:**
  - Corregido el import duplicado de `storage`, además de tipado seguro de errores y
    dependencia real de `useEffect` en `RubbishCollectionDialog.tsx`.
  - `npm.cmd run typecheck` → aprobado.
  - ESLint focalizado de los módulos tocados y `git diff --check` → aprobados.
  - `npm.cmd run build` → aprobado; `npm.cmd run lint` todavía falla con 127 errores y
    29 avisos históricos fuera de este lote y se seguirá cerrando por dominio.

### T-015 — Completar QA automatizado

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-012, T-014
- Añadir pruebas de reglas Firestore/Storage, Functions y repositorios.
- Añadir E2E de autenticación, proyectos, trabajos, fotos, inventario, facturas y reportes.
- Incorporar casos de usuario ajeno, sesión expirada, payload inválido y doble envío.
- **Aceptación:** la suite completa corre contra emuladores y no depende de servicios
  remotos ni APIs pagas.

### T-016 — Medir y corregir rendimiento

- **Prioridad:** P2 · **Estado:** pendiente · **Depende de:** T-015
- Medir baseline del bundle, carga inicial y consultas principales.
- Dividir rutas con `React.lazy()` y detectar N+1 en `ProjectDetails`, `Statements` y
  dashboards.
- Comparar métricas antes/después; no optimizar por intuición.
- **Aceptación:** existe reporte de medición y el bundle/tiempo de carga mejora sin cambiar
  comportamiento funcional.

## Fase 7 — Release controlado

### T-017 — Documentar operación y preparar staging

- **Prioridad:** P1 · **Estado:** pendiente · **Depende de:** T-013, T-015, T-016
- Crear guía de variables, emuladores, despliegue, backup, rollback, alertas de costo y
  smoke tests.
- Revisar `.env` histórico y rotar cualquier credencial que haya sido versionada.
- Preparar staging, sin desplegar producción.
- **Aceptación:** checklist operativo revisado y aprobado por el operador.

### T-018 — Gate de producción

- **Prioridad:** P0 · **Estado:** pendiente · **Depende de:** T-017
- Verificar seguridad sin hallazgos críticos, tests aprobados, E2E final, rollback y
  backup cuando aplique.
- Requiere confirmación explícita del operador antes de cualquier despliegue o migración.
- **Aceptación:** solo entonces puede pasar a `desplegada`.

## Fuera de alcance hasta cerrar la Fase 2

- Nuevas features de negocio.
- Rediseño visual amplio.
- Optimización especulativa.
- Migraciones destructivas o limpieza irreversible del historial.
