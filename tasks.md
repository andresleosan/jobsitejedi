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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-005, T-007
- Migrar creación, edición, revisión y completado de trabajos a Firebase Storage.
- Mantener miniaturas, descarga y manejo de errores.
- Verificar que las rutas antiguas no se conviertan accidentalmente en URLs públicas.
- **Aceptación:** E2E de carga, vista, descarga y rechazo de foto ajena.
- **Avance 2026-08-24:**
  - Añadido `src/lib/firebase/repositories/jobPhotos.ts` para crear referencias
    `jobPhotos`, subir original + thumbnail, listar, generar object URLs privados y borrar
    archivos/referencias.
  - Las rutas quedan ligadas al `jobId`, `builderId`, tipo de foto y nombre saneado; un
    builder no puede operar sobre jobs ajenos y los archivos no generan URLs públicas.
  - Reglas Firestore para `jobPhotos` y reglas Storage separan create/update/delete,
    evitando leer `request.resource` durante un borrado.
  - Suite específica Storage + repositorio → 2 archivos, 7 tests aprobados; suite Firebase
    completa → 12 archivos, 33 tests aprobados. Typecheck, ESLint focalizado y build pasan.
  - Añadido `JobPhotoDialog` e integrado en `JobsToDoList`: selección de hasta 10 imágenes,
    preview, thumbnail, progreso, galería privada, borrado autorizado y feedback accesible.
  - La UI cubre evidencia de completado para builders y `ManagerJobReviewPanel` permite
    revisar fotos privadas y decidir `completed`/`needs_correction`.
  - `/managers` ya valida rol Firebase y monta el dashboard manager Firebase; las rutas
    antiguas de manager dejan de bloquear esta vertical.
  - Las reglas limitan al builder a enviar solo `approved/needs_correction` a
    `waiting_review`; el manager es quien decide el cierre. Suite Firebase → 12 archivos,
    33 tests aprobados.
  - Añadida `tests/job-photos.firebase.spec.ts` y el script
    `npm.cmd run test:e2e:firebase:emulator`: 1 E2E aprobado contra Auth, Functions,
    Firestore y Storage Emulator. Cubre login aislado, carga de original + thumbnail,
    descarga privada mediante object URL, galería visible y envío a `waiting_review`.
  - La primera corrida detectó que el router importaba Supabase legacy sin variables y dejaba
    la pantalla en blanco; el entorno E2E ahora inyecta endpoints placeholder sin credenciales
    ni llamadas remotas. La segunda detectó un selector que no respetaba el `aria-label`; se
    corrigió el test para usar el nombre accesible. La UI Supabase heredada de dominios fuera
    de fotos no se modifica todavía.

## Fase 4 — Funciones y dominios restantes

### T-009 — Implementar Cloud Functions privilegiadas

- **Prioridad:** P1 · **Estado:** revisión · **Depende de:** T-003, T-004
- Implementar invitaciones, asignación de roles, procesamiento de facturas,
  extracción de Excel y limpieza programada.
- Validar entradas, rol, rutas, timeouts, reintentos finitos y errores seguros.
- No conectar APIs de pago sin confirmación de costo y configuración de límites.
- **Pruebas:** manager permitido, builder rechazado, payload inválido e idempotencia.
- **Aceptación:** `functions` tiene tests ejecutables y ningún secreto aparece en logs.
- **Avance 2026-08-24:**
  - Implementado el primer slice de invitaciones: `createManagerInvitation`,
    `validateInvitationCode` y `consumeInvitation` en Functions, con código aleatorio de
    12 caracteres, hash SHA-256 persistido, expiración de 5 minutos y consumo de un solo uso.
  - La creación y asignación de rol exigen claim manager; la validación no revela si un código
    falló por inexistencia, expiración o estado usado; los writes directos a `invitations` siguen
    bloqueados por Firestore Rules.
  - Conectadas `Invite.tsx`, `Auth.tsx` y el dashboard manager al cliente callable Firebase;
    la cuenta creada consume la invitación y recibe el rol server-side.
  - Añadidas pruebas de código inválido y rechazo builder→crear invitación.
  - La prueba `tests/firebase/functions.test.ts` cubre en Emulator el camino feliz
    manager→crear invitación→builder consumir, asignación server-side del rol y segundo consumo
    rechazado; `npm.cmd run test:firebase:emulator` queda en 13 archivos y 37 tests aprobados.
  - Implementado el primer slice de facturas con `submitInvoice` y `reviewInvoice`: exige roles,
    valida fechas e importes enteros en peniques, comprueba propiedad del proyecto y metadata real
    del archivo privado, limita cada comprobante a menos de 10 MB y conserva snapshots de auditoría.
  - El alta y la revisión son idempotentes para el mismo payload; la revisión es terminal y
    manager-only. `maxInstances: 10` y timeouts explícitos acotan abuso/costo básico, aunque la cuota
    por usuario o App Check queda como endurecimiento previo a producción.
  - T-009 sigue en progreso hasta cubrir extracción de Excel, limpieza programada, protección por
    usuario y el manejo compensatorio si falla la asignación de claims después de crear una cuenta.

### T-010 — Migrar inventario, herramientas y solicitudes

- **Prioridad:** P1 · **Estado:** revisión · **Depende de:** T-005, T-009
- Crear repositorios para materiales, uso, entregas, herramientas, checkouts y residuos.
- Cubrir transiciones de estado, cantidades y operaciones manager-only.
- Reemplazar listeners `postgres_changes` por listeners Firestore con cleanup.
- **Aceptación:** escenarios builder/manager pasan con reglas y repositorios tipados.
- **Avance 2026-08-24:**
  - Añadido `src/lib/firebase/repositories/inventory.ts` con modelos tipados para materiales,
    herramientas, solicitudes, checkouts y transferencias.
  - Los checkouts y transferencias usan transacciones Firestore: un tool no puede prestarse dos
    veces a la vez, una devolución repetida falla y una transferencia manager-only no puede dejar
    stock negativo; el alta de transferencias builder queda pendiente de una Function privilegiada.
  - Añadidas reglas Firestore con lectura para usuarios autenticados, gestión de catálogo solo
    para managers y operaciones de builder limitadas a sus propias solicitudes/checkouts.
  - Añadidos `recordMaterialUsage`, solicitudes de entrega con ítems y ciclo de residuos; las
    entregas/residuos aíslan builder y manager, y las operaciones que descuentan stock quedan
    manager-only hasta implementar una Function privilegiada para builders.
  - La suite Firebase en Emulator queda en 13 archivos y 38 tests aprobados; typecheck y ESLint
    focalizado pasan. Quedan para el siguiente incremento la migración de UI de herramientas,
    solicitudes, entregas y residuos, y los E2E específicos; la tarea no se aprueba todavía.
  - `StorageMaterialsTab` migrada a los repositorios Firebase y Storage privado: CRUD de catálogo,
    filtros, stock mínimo, fotos con object URLs temporales y cleanup al desmontar; no conserva
    imports Supabase. Build aprobado y E2E existente de fotos → 1 test aprobado.
  - `StorageToolsTab` migrada a Firestore mediante `subscribeToStorageTools` con cleanup, y a
    repositorio tipado para altas, ediciones y borrado seguro; no conserva imports Supabase ni
    listeners `postgres_changes`. Typecheck, ESLint focalizado, build y Emulator Firebase (13
    archivos, 38 tests) aprobados. Falta cubrir esta UI con E2E específico.
  - `Storage`, `ToolRequestDialog`, `ToolRequestsManagement` y `ToolCheckoutsTab` migrados al flujo
    Firebase. Builder solicita desde su dashboard y manager aprueba, entrega y recibe desde
    Storage; todos los listeners Firestore liberan su suscripción al desmontar.
  - Checkout y devolución vinculados a la solicitud se ejecutan en transacciones atómicas: se
    valida disponibilidad, se conserva el destinatario original, se sincronizan tool/request/
    checkout y las operaciones quedan restringidas a manager tanto en repositorio como en reglas.
  - Reglas de solicitudes endurecidas con claves permitidas, proyecto perteneciente al builder,
    estado inicial obligatorio y transiciones válidas. Emulator Firebase: 13 archivos/38 tests;
    E2E de fotos e inventario: 2/2; typecheck, ESLint focalizado y build aprobados.
  - `MaterialDeliveryDialog` y `ManagerMaterialDeliveryDialog` migrados a Firebase e integrados en
    ambos dashboards. Builder crea una solicitud con ítems del catálogo y manager la mueve por
    `pending → in_progress → delivered/rejected`; los listeners de solicitudes, ítems y materiales
    tienen cleanup y la transición manager usa una transacción para evitar carreras.
  - Cabecera e ítems de entrega se crean en un único batch. Las reglas exigen proyecto propio,
    catálogo existente, cantidades válidas, claves cerradas e ítems solo durante la creación
    atómica; además impiden saltos de estado y cambios de identidad/proyecto. `requestedByName` es
    una desnormalización aditiva e inmutable; documentos antiguos conservan fallback y su rollback
    consiste en dejar de escribir/leer el campo, sin reescritura destructiva.
  - Emulator Firebase aprobado en 13 archivos/38 tests y E2E de fotos, herramientas y entregas en
    3/3. El test integral de invitaciones usa 15 s explícitos para absorber el arranque local de
    Functions sin relajar ninguna aserción funcional.
  - `RubbishCollectionDialog` y `ManagerRubbishDialog` migrados a Firebase e integrados en ambos
    dashboards. Builder carga de 1 a 10 imágenes privadas y sigue su historial en vivo; manager
    revisa la galería y ejecuta la transición transaccional `pending → resolved`, sin borrado de
    solicitudes para conservar auditoría. Los listeners y object URLs tienen cleanup al cerrar o
    desmontar los diálogos.
  - Las fotos usan rutas `rubbish/{builderId}/{requestId}/{file}` y solo aceptan imágenes no vacías
    menores de 10 MB. Si falla la creación Firestore se limpian los uploads huérfanos; una vez que
    existe la solicitud, Storage consulta Firestore y bloquea sobrescritura/borrado de evidencia.
    Firestore valida proyecto propio, nombre firmado, claves, rutas, cantidad de fotos, estado y
    longitud de descripción; builder queda aislado y manager solo puede resolver.
  - Evidencia final del bloque residuos: typecheck, ESLint focalizado y build aprobados; Emulator
    Firebase en 13 archivos/39 tests y E2E de fotos, herramientas, entregas y residuos en 4/4.
  - Añadida la pestaña manager `Movements` en Storage para registrar transferencias a proyecto y
    consumo directo. Ambos flujos descuentan stock central en una transacción y publican historial
    en vivo con cleanup; la UI valida disponibilidad, cantidad, proyecto, fecha y notas antes de
    ejecutar. Builders continúan sin permiso para descontar stock directamente.
  - Transferencias y consumos son registros de auditoría inmutables. Las reglas exigen identidad
    firmada, claves cerradas, proyecto/material existentes y que `getAfter` refleje exactamente el
    descuento declarado sin stock negativo. Cada registro conserva snapshots verificados de nombre
    de material, unidad y proyecto para seguir siendo legible tras cambios del catálogo.
  - Evidencia final del bloque: typecheck, ESLint focalizado, `git diff --check` y build de producción
    aprobados; Emulator Firebase en 13 archivos/39 tests y E2E de fotos, herramientas, entregas,
    residuos y movimientos en 5/5. El guard global informa las 137 referencias Supabase históricas
    asignadas a T-011/T-012; los archivos nuevos y el flujo activo de Storage no añaden ninguna.
  - T-010 pasa a revisión con evidencia. La futura operación builder privilegiada sigue fuera del
    cliente y depende de una Function de T-009; no bloquea el flujo manager-only aceptado aquí.

### T-011 — Migrar facturas, reportes y evaluaciones de riesgo

- **Prioridad:** P1 · **Estado:** en-progreso · **Depende de:** T-007, T-009, T-010
- Migrar facturas, proveedores, extracción, reportes diarios, firmas y documentos.
- Revisar especialmente que `documents` no exponga archivos de otros usuarios y que la
  ruta/bucket de evaluaciones de riesgo sea coherente.
- **Aceptación:** archivos, datos financieros y firmas tienen tests de autorización y E2E.
- **Avance 2026-08-24:**
  - Añadido repositorio Firebase tipado para facturas, importes exactos en peniques, subida privada
    con borrado compensatorio y listeners con cleanup. El builder ve solo el historial del proyecto
    abierto; el manager filtra, descarga la evidencia y aprueba o rechaza con nota opcional.
  - Firestore bloquea escrituras directas y aísla lecturas builder; Storage exige la ruta exacta
    `invoices/{uid}/{invoiceId}/{archivo}`, imagen/PDF menor de 10 MB y vuelve el objeto inmutable
    cuando existe el registro financiero. El contrato y rollback están en
    `docs/data-model-invoices.md`; no se aplicó migración ni se conectó OCR/API de pago.
  - Autocrítica de seguridad: autenticación y rol se verifican server-side, las entradas y metadata
    se revalidan, no hay secretos nuevos y los archivos nuevos no contienen referencias Supabase.
    La evidencia de este incremento detectó 137 referencias heredadas y 4 avisos altos/2 moderados;
    ambos hallazgos quedaron resueltos posteriormente en T-012/T-019.
  - Evidencia: `npm.cmd run typecheck`, build de producción, ESLint focalizado y
    `git diff --check` aprobados; `npm.cmd run test:firebase:emulator` → 13 archivos/42 tests;
    `npm.cmd run test:e2e:firebase:emulator` → 6/6 E2E, incluido importe inválido,
    builder→envío privado→manager descarga y aprobación.
  - T-011 continúa para proveedores, extracción, reportes diarios, firmas, documentos y
    evaluaciones de riesgo; no se marca como aprobada con alcance parcial.

## Fase 5 — Retirada de Supabase

### T-012 — Eliminar dependencias runtime de Supabase

- **Prioridad:** P0 · **Estado:** revisión · **Depende de:** T-005, T-006, T-007, T-008,
  T-009, T-010, T-011
- Eliminar imports runtime de Supabase en `src`.
- Eliminar cliente, tipos y dependencia npm solo cuando no haya consumidores.
- Mantener migraciones históricas como evidencia hasta decidir su limpieza.
- **Pruebas:** `npm run test:provider-guard` debe pasar con cero referencias.
- **Aceptación:** `rg` y el guard confirman que no existe una ruta híbrida accidental.
- **Avance 2026-08-25:**
  - `ProjectDetails` y `Statements`, las dos rutas alcanzables que quedaban, consumen repositorios
    Firebase; los módulos Supabase sin consumidores, cliente, tipos y helper Storage se retiraron.
  - Se eliminaron `@supabase/supabase-js` y las variables `VITE_SUPABASE_*` del runtime. Las
    migraciones y Functions históricas permanecen intactas como evidencia para T-013.
  - `npm.cmd run test:provider-guard` → 3/3 y `rg` → cero referencias Supabase bajo `src`.
    La aceptación E2E manager→proyecto→ledger pasa dentro de la suite 7/7.
  - Autocrítica y seguridad: no se hallaron vulnerabilidades críticas; acceso y roles siguen
    aplicándose en repositorios y Rules. No hubo despliegue, migración ni acceso a datos reales.

### T-013 — Retirar o aislar infraestructura Supabase antigua

- **Prioridad:** P1 · **Estado:** revisión · **Depende de:** T-012
- Documentar qué migraciones se conservan como historial y qué carpetas quedan fuera del
  runtime.
- Si se aplica la migración Storage anterior, hacerlo primero en staging con backup
  verificado, rollback documentado y confirmación explícita del operador.
- Validar políticas efectivas en `pg_policies` antes de retirar el proveedor.
- **Aceptación:** no se ejecuta ninguna acción destructiva en producción sin checkpoint.
- **Avance 2026-08-25:**
  - Inventariados 67 migrations, 3 Edge Functions, 1 script SQL y la configuración CLI
    histórica; quedaron documentados como artefactos fuera del runtime Firebase.
  - Añadidos `docs/legacy-supabase.md`, `supabase/README.md` y ADR-002 para fijar la
    frontera: `src/` y `functions/src/` no importan ni invocan Supabase.
  - README y `docs/supabase-setup.md` ya no presentan Supabase como configuración activa;
    la guía quedó limitada a validación autorizada en staging.
  - El guard `npm.cmd run test:provider-guard` verifica ambos árboles runtime y pasa 3/3;
    `npm.cmd run typecheck`, `npm.cmd run lint` y `git diff --check` también pasan.
  - No se ejecutaron `pg_policies`, `supabase db push`, despliegues, migraciones ni borrados:
    el estado remoto requiere acceso autorizado, backup verificable, rollback y checkpoint
    explícito del operador antes de cerrar la retirada del proveedor.

## Fase 6 — Calidad, seguridad y rendimiento

### T-014 — Cerrar TypeScript y lint por lotes

- **Prioridad:** P1 · **Estado:** revisión · **Depende de:** T-012
- Corregir primero errores de compilación y después dividir la deuda de `any` por dominio:
  auth, proyectos/trabajos, inventario, finanzas y UI.
- Resolver dependencias reales de `useEffect`; no silenciar reglas globalmente.
- **Aceptación:** `tsc --noEmit` y `npm run lint` pasan sin desactivar reglas de seguridad.
- **Avance 2026-08-25:**
  - Corregido el import duplicado de `storage`, además de tipado seguro de errores y
    dependencia real de `useEffect` en `RubbishCollectionDialog.tsx`.
  - Tipados explícitos en `QRScannerDialog.tsx` y `JobCard.tsx`; interfaces vacías
    reemplazadas en `command.tsx` y `textarea.tsx`; import ESM en `tailwind.config.ts`;
    errores `unknown` seguros en la función histórica de Supabase; y limpieza de streams
    de cámara corregida en `CameraCapture.tsx`.
  - `npm.cmd run typecheck` → aprobado; `npm.cmd run lint` → 0 errores y 7 avisos
    no bloqueantes de Fast Refresh en componentes UI compartidos.
  - `npm.cmd run build` → aprobado; `npm.cmd run test:provider-guard` → 3/3; `npm.cmd
    run test:firebase:emulator` → 13 archivos y 43 pruebas aprobadas en la segunda
    ejecución (la primera tuvo un timeout transitorio de carga del emulador Functions).
  - `npm.cmd audit --omit=dev` → 0 vulnerabilidades; `git diff --check` → aprobado.
  - Autocrítica de seguridad: los cambios no agregan endpoints, secretos, permisos ni
    dependencias runtime; no hubo despliegue, migración ni acceso a datos reales.

### T-015 — Completar QA automatizado

- **Prioridad:** P1 · **Estado:** revisión · **Depende de:** T-012, T-014
- Añadir pruebas de reglas Firestore/Storage, Functions y repositorios.
- Añadir E2E de autenticación, proyectos, trabajos, fotos, inventario, facturas y reportes.
- Incorporar casos de usuario ajeno, sesión expirada, payload inválido y doble envío.
- **Aceptación:** la suite completa corre contra emuladores y no depende de servicios
  remotos ni APIs pagas.
- **Avance 2026-08-25:**
  - La cobertura existente queda consolidada en reglas Firestore/Storage, autenticación,
    Functions, repositorios y siete flujos E2E de los dominios de trabajos, fotos, inventario,
    facturas y reportes.
  - Se verificaron casos de usuario anónimo o ajeno, escalación de rol, payload inválido,
    sesión no autorizada, uploads inválidos, doble consumo e idempotencia.
  - `npm.cmd run test:firebase:emulator` → 13 archivos y 43 tests aprobados.
  - `npm.cmd run test:e2e:firebase:emulator` → 7 E2E aprobadas; reporte HTML local generado en
    `qa/reports`.
  - QA avanzado aplicado: pruebas de integración/contrato y casos límite de seguridad. La
    medición de carga queda diferida a T-016; no se usaron servicios remotos, credenciales de
    producción ni APIs pagas.

### T-016 — Medir y corregir rendimiento

- **Prioridad:** P2 · **Estado:** revisión · **Depende de:** T-015
- Medir baseline del bundle, carga inicial y consultas principales.
- Dividir rutas con `React.lazy()` y detectar N+1 en `ProjectDetails`, `Statements` y
  dashboards.
- Comparar métricas antes/después; no optimizar por intuición.
- **Aceptación:** existe reporte de medición y el bundle/tiempo de carga mejora sin cambiar
  comportamiento funcional.
- **Avance 2026-08-25:**
  - Se documentó el baseline antes/después en `docs/performance-baseline.md`.
  - `src/App.tsx` usa `React.lazy()` por ruta y `Suspense`: el chunk inicial bajó de 1.811,33 kB
    a 330,70 kB (-81,7%); gzip bajó de 497,78 kB a 107,38 kB (-78,4%).
  - `ProjectDetails` (2 lecturas), `Statements` (5 lecturas) y dashboards fueron revisados sin
    detectar un N+1 claro; las lecturas paralelas y suscripciones bajo demanda se conservaron.
  - Typecheck y build pasan; lint queda en 0 errores y 7 warnings preexistentes. La regresión
    E2E Firebase pasó 7/7 contra emuladores.
  - La medición Web Vitals de navegador queda pendiente por falta del ejecutable Chromium local;
    no hubo despliegue, migración ni acceso a servicios remotos o APIs pagas.

### T-019 — Cerrar vulnerabilidades de dependencias

- **Prioridad:** P0 · **Estado:** revisión · **Depende de:** T-011, T-014
- Sustituir `xlsx`, usado por reportes y carga masiva, por una alternativa mantenida o aislar su
  procesamiento con límites y validaciones equivalentes; la versión actual no tiene fix publicado.
- Evaluar la migración controlada a React Router 7 para cerrar los avisos moderados restantes.
- Clasificar y corregir las rutas transitivas de `brace-expansion`, `minimatch` y `picomatch`,
  separando tooling de dependencias runtime cuando corresponda.
- No ejecutar `npm audit fix --force`: cualquier salto mayor debe pasar pruebas de regresión.
- **Aceptación:** `npm audit --omit=dev` no reporta vulnerabilidades altas/críticas, o existe una
  excepción temporal documentada con exposición, mitigación, responsable y fecha de retirada.
- **Avance 2026-08-25:**
  - `react-router-dom` quedó en 7.18.2 y pasó typecheck, build y regresión E2E completa.
  - Se retiró `xlsx`; el ledger exporta CSV sin parser y neutraliza fórmulas incluso tras espacios o
    tabulaciones. La carga Excel huérfana se eliminó y su futura alternativa Firebase sigue en T-009.
  - `@playwright/test` y `tailwindcss-animate` quedaron en `devDependencies`, aislando
    `tailwindcss` y sus transitivas del árbol productivo.
  - `npm.cmd audit --omit=dev` → 0 vulnerabilidades. El audit completo conserva 6 altas y
    7 moderadas únicamente en tooling de desarrollo; no forman parte del bundle/runtime y se
    mantienen visibles para el lote de calidad, sin usar `npm audit fix --force`.

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

## Seguimiento de T-009 — 2026-08-27

- Se añadió rate limiting persistente por usuario y operación para los callables de roles,
  invitaciones y facturas, con ventanas y límites explícitos en Firestore.
- `consumeInvitation` permite reintentar idempotentemente para el mismo usuario y revierte la
  invitación usada si falla la asignación del custom claim; el error externo no filtra detalles.
- `cleanupOldProjects` queda programada cada 24 horas para limpiar invitaciones expiradas y límites
  inactivos. El borrado de proyectos está desactivado por defecto, exige `cleanupEligibleAt` anterior
  a 30 días, ausencia de registros relacionados y `ENABLE_PROJECT_CLEANUP=true`.
- El contrato, backup y rollback están documentados en `docs/data-model-functions.md`.
- Evidencia: `npm.cmd run build:functions`, `npm.cmd run typecheck`, `npm.cmd run lint`,
  `npm.cmd run test:provider-guard` (3/3) y `git diff --check` aprobados.
- `npm.cmd run test:firebase:emulator` no pudo iniciar porque el entorno tiene Java 8 y Firebase
  CLI 15.26 exige JDK 21+. La importación Excel sigue pendiente; T-009 conserva `en-progreso`.

## Seguimiento de T-009 — 2026-08-28

- Implementado `extractJobsFromExcel` para archivos privados `.xlsx`, `.csv` y `.tsv`, con parser
  acotado sin `xlsx`, límites de 5 MiB/500 filas/16 columnas/2.000 caracteres por celda y rechazo
  de fórmulas.
- La callable exige claim `manager`, ruta `job-imports/{managerId}/{fileName}`, MIME permitido,
  proyecto existente con builder propietario y rate limit de 5 importaciones por hora por manager.
- Cada importación usa hash de contenido, documento `jobImports/{importId}` e IDs deterministas en
  `jobs/`; los reintentos devuelven los mismos IDs sin duplicar trabajos.
- Añadidas reglas de Storage, wrapper frontend, pruebas del parser y prueba emulada de importación
  idempotente. `npm.cmd --prefix functions test` pasa 3/3; la suite Firebase completa sigue sin
  poder arrancar mientras el entorno solo tenga Java 8 y Firebase CLI 15.26 exija JDK 21+.
- T-009 conserva `en-progreso` hasta validar la suite emulada y revisar el flujo desde la UI que
  subirá los archivos de importación.

## Seguimiento de T-009 — 2026-08-28 (continuación)

- Integrada la carga desde `ManagerDashboard` mediante un diálogo accesible: selección de proyecto,
  formatos y límite visibles, validación cliente, bloqueo de doble envío y estados de éxito/error.
- El archivo se sube con nombre temporal a `job-imports/{managerId}/` y se entrega a la callable;
  no se exponen URLs públicas ni contenido del archivo en la UI.
- Documentado el criterio visual de esta interacción en `STACK.md`; se conserva el Design DNA de
  BuildTrack Pro y no se introduce un rediseño paralelo.
- Corregida la idempotencia para que volver a subir la misma hoja al mismo proyecto no cree trabajos
  duplicados aunque cambie el nombre temporal de Storage.
- Evidencia: `npm.cmd --prefix functions run build`, `npm.cmd --prefix functions test` (3/3),
  `npm.cmd run typecheck`, `npm.cmd run lint` (0 errores, 7 warnings preexistentes),
  `npm.cmd run build` y `npm.cmd run test:provider-guard` (3/3); `git diff --check` limpio.
- T-009 continúa `en-progreso`: falta ejecutar la suite Firebase completa contra emuladores con JDK
  21+; el entorno actual solo tiene Java 8 y Firebase CLI 15.26 no puede iniciar esos emuladores.

## Seguimiento de T-009 - 2026-08-28 (suite emulada)

- La suite completa contra Auth, Firestore, Functions y Storage Emulator se ejecuto con JDK 21
  usando configuracion Firebase temporal dentro del workspace.
- Evidencia: `npm.cmd run test:firebase:emulator` -> 14 archivos y 49 tests aprobados; el build de
  Functions tambien paso durante el comando.
- Se validaron manager permitido, builder rechazado, payloads invalidos, invitaciones idempotentes,
  claims server-side, facturas, Storage privado y la importacion idempotente de trabajos.
- T-009 queda en `revision`: la implementacion y la evidencia automatizada estan completas para el
  alcance actual; queda la revision humana del flujo y de los criterios de cierre antes de aprobar.

## Seguimiento de T-011 - 2026-08-28 (reportes y riesgo)

- Añadido `src/lib/firebase/repositories/reports.ts` con contratos tipados para reportes diarios,
  evaluaciones de riesgo y firmas; los builders solo reportan y firman proyectos propios.
- Las evaluaciones se suben como PDF privado a `documents/{projectId}/{assessmentId}/{fileName}`;
  si falla la metadata Firestore se borra el archivo como compensacion.
- Las firmas usan ID determinista `{assessmentId}_{userId}`, reintento seguro y documentos inmutables;
  el listado builder evita queries amplias no autorizables y el manager conserva lectura completa.
- Añadidas reglas Firestore/Storage y pruebas de aislamiento builder/manager, propiedad de proyecto,
  rutas privadas, MIME/tamaño y rechazo de escrituras forjadas. El contrato y rollback están en
  `docs/data-model-reports.md`.
- Evidencia: `npm.cmd run test:firebase:emulator` -> 14 archivos/49 tests pasados; `npm.cmd run
  typecheck`; `npm.cmd run build:functions`; `npm.cmd run build`; `npm.cmd run lint` (0 errores,
  7 warnings preexistentes); `npm.cmd run test:provider-guard` (3/3); `git diff --check` limpio.
- T-011 conserva `en-progreso`: proveedores, extracción, integración completa de UI y E2E de este
  bloque quedan pendientes; no se aplicaron migraciones, despliegues ni cambios remotos.

## Seguimiento de T-011 - 2026-08-28 (proveedores)

- Anadido `src/lib/firebase/repositories/suppliers.ts` con normalizacion canonica de nombres,
  alta idempotente, lectura autenticada y gestion restringida a managers.
- Anadidas reglas Firestore para proveedores: builders solo leen, las escrituras exigen rol manager,
  el ID debe coincidir con `normalizedName` y la eliminacion queda bloqueada para preservar historial.
- Anadida la prueba de reglas y la prueba de repositorio para idempotencia, edicion de capitalizacion,
  lectura builder y rechazo de alta forjada; el contrato y rollback estan en
  `docs/data-model-suppliers.md`.
- Integrado el selector de proveedores en `InvoiceSubmissionDialog.tsx`, con catalogo autenticado,
  entrada manual de respaldo, labels accesibles y estados de carga/error sin bloquear el flujo actual.
- Evidencia: `npm.cmd run test:firebase:emulator` -> 15 archivos/52 tests pasados; `npm.cmd run
  typecheck`; `npm.cmd run build:functions`; `npm.cmd run build`; `npm.cmd run lint` (0 errores,
  7 warnings preexistentes); `npm.cmd run test:provider-guard` (3/3); y `git diff --check` limpio.
- El E2E de facturas fue intentado con emuladores y llego al flujo de envio/revision, pero el runner
  local quedo retenido durante el apagado; no se cuenta como aprobado y requiere repetirlo en CI o
  con el runner estabilizado.
- T-011 conserva `en-progreso`: falta la UI manager de proveedores, extraccion OCR/entrenamiento y
  E2E completo; no se aplicaron migraciones, despliegues ni cambios remotos.

## Fuera de alcance hasta cerrar la Fase 2

- Nuevas features de negocio.
- Rediseño visual amplio.
- Optimización especulativa.
- Migraciones destructivas o limpieza irreversible del historial.
