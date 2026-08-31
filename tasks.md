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

Estados auxiliares: `bloqueada` cuando existe un impedimento verificable que debe resolverse antes
de continuar, y `supersedida` cuando otra tarea reemplazó explícitamente su estrategia. Ninguno de
los dos estados cuenta como trabajo terminado o desplegado.

Una tarea solo puede pasar a `revisión` después de ejecutar sus pruebas. Las tareas que
toquen producción necesitan confirmación explícita del operador.

## Reconciliación del backlog — 2026-08-31

- Los estados de los encabezados y esta sección son la fuente vigente; los bloques `Seguimiento`
  conservan la fotografía histórica del momento en que se escribieron.
- `BRIEF.md` fue restaurado a partir del alcance ya aceptado en `STACK.md`, sin agregar features.
- T-005 pasa de `en-progreso` a `revisión`: sus pendientes históricos quedaron cubiertos por
  T-006, T-008 y T-012, con repositorios Firebase, E2E y cero imports runtime de Supabase.
- T-021 pasa de `revision` a `aprobada`: Vercel, Firebase Auth, reglas, login email y dos cuentas
  Google provisionadas cumplieron la aceptación productiva.
- El operador aprobó explícitamente T-005, T-009, T-010, T-011, T-012, T-013, T-014, T-015,
  T-016, T-019 y T-022 el 2026-08-29, incluyendo el cierre de T-013 por aislamiento y la
  aceptación temporal del riesgo de tooling documentado.
- El operador reemplazó la estrategia de dos proyectos el 2026-08-29: consolidar el backend
  validado en `jobsitejedi` y retirar `jobsitejedi-staging` solo después de una verificación segura.
- T-017 queda `supersedida` por cambio de estrategia; T-018 concentra el despliegue productivo,
  la observación y el gate destructivo final.
- El corte coordinado del 2026-08-31 desplegó T-023 a T-029, T-032 y T-033; la estabilización T-034
  quedó fusionada en `main` en `864335ecf4e497221469e3462a623c5211e5846e`. El CI exacto de ese
  merge aprobó calidad/contratos y Firebase Emulator/E2E con evidencia inmutable.
- T-029 quedó `desplegada` como instrumentación/observación: la site key oficial y el cliente están
  activos, y Functions conserva `ENFORCE_APP_CHECK=false`. T-035 separa el eventual enforcement y
  permanece `en-progreso`. T-018 también permanece `en-progreso` porque `jobsitejedi-staging` sigue
  intacto y su borrado exige siete días desde el nuevo corte, inventario final y autorización
  destructiva separada.
- Las tres identidades QA compartidas de producción están deshabilitadas, sin claims de aplicación y
  con tombstones inactivos. La matriz positiva `admin`/`manager`/`builder` se prueba en Emulator; su
  reactivación productiva no forma parte de este release.

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

### T-020 — Estabilizar login y añadir autenticación con Google

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-003
- Impedir que una identidad Firebase válida sin claim `manager`/`builder` provoque un bucle entre
  `/auth` y `/dashboard`; debe cerrar la sesión y mostrar un error accionable sin revelar datos.
- Añadir Google como proveedor de autenticación mediante Firebase Auth, sin autoasignar roles ni
  relajar las reglas de Firestore/Storage.
- Mantener email/contraseña como alternativa y conservar el registro por invitación existente.
- Documentar la activación operativa de Google y los dominios autorizados en Firebase Console.
- **Pruebas:** credenciales inválidas, credenciales válidas con rol, identidad sin rol, contrato de
  errores Google, control accesible en UI y regresión E2E del login.
- **Aceptación:** ninguna sesión sin rol entra al dashboard ni genera redirecciones repetidas; una
  cuenta Google ya provisionada con claim llega al dashboard correspondiente.
- **Avance 2026-08-28:**
  - La cuenta real de QA autentica correctamente en Firebase, pero no tiene custom claim de rol. El
    defecto quedó reproducido con 7.629 transiciones `/auth`↔`/dashboard` en 4 segundos.
  - El adaptador ahora exige rol para email/contraseña, Google y registros por invitación; una sesión
    sin rol se cierra y devuelve un mensaje seguro. La repetición real quedó estable en `/auth` con
    2 eventos documentales y cero visitas a `/dashboard`.
  - Añadido Google con selector de cuenta, errores normalizados, botón accesible y bloqueo de doble
    envío. El proveedor no autoasigna permisos y la contraseña se limpia después de un rechazo.
  - El estado sin rol ahora permanece visible con acciones `Cerrar sesion` y `Reintentar`; el mismo
    estado se activa tanto para email/contrasena como para Google y nunca autoriza el dashboard.
  - La auditoria remota de solo lectura encontro 1 usuario activo, 0 managers, 0 builders y 1 cuenta
    sin rol. El procedimiento de asignacion y rollback esta en `docs/auth-role-operations.md`; no se
    cambiaron usuarios ni configuracion remota.
  - El runner quedo fijado a Node 22.23.2, JDK 21 y 30 s de descubrimiento. Node 20 no se adopta por
    haber terminado soporte en marzo de 2026; detalle operativo en `docs/runtime-qa.md`.
  - Evidencia final: suite Firebase limpia con Node 22/JDK 21 (15 archivos/60 tests) y E2E focalizado
    de auth (1/1) aprobados, con cierre correcto de emuladores.
  - La consulta remota de solo lectura confirmo Google habilitado, cliente OAuth configurado y los
    dominios `localhost`, `jobsitejedi.firebaseapp.com` y `jobsitejedi.web.app` autorizados. El E2E
    focalizado paso 1/1 despues de cambiar QA a `http://localhost:5173`.
  - Con autorizacion explicita del operador, se asigno `manager` al unico usuario activo. El dry-run
    confirmo rol anterior `null`; la relectura Admin confirmo `manager`, el login real verifico el
    ID token y el smoke UI termino en `/managers` sin estado de rol faltante. No hubo despliegue y
    las credenciales se ingresaron de forma segura sin persistencia.
  - Validacion productiva Google completada: una identidad nueva fue creada sin rol, permanecio en
    `/auth` con el estado explicito esperado, recibio `manager` mediante dry-run y mutacion
    server-side autorizada, y el operador confirmo acceso normal posterior. Una segunda identidad
    Google fue verificada por correo/proveedor y recibio `manager` con el mismo procedimiento.
  - El helper operativo ahora admite seleccion multiusuario por correo, proveedor y conteo esperado,
    preserva claims, verifica la escritura y sanitiza fallos del SDK para no imprimir tokens.
  - Autocritica final: Node 22.23.2/JDK 21 ejecuto 16 archivos y 65/65 pruebas Firebase. El runner
    elimina `DEBUG` heredado para impedir que Firebase Tools liste variables del proceso; la
    regresion de fallo del helper confirmo salida de una linea y cero patrones de token, y el
    dry-run remoto final releyo `manager` sin modificar la cuenta.
  - Cierre humano: el operador confirmo que la segunda cuenta Google con rol `manager` puede
    ingresar y cerrar sesion sin problemas. T-020 cumple su aceptacion y pasa a `aprobada`.

### T-021 — Corregir configuracion de produccion en Vercel

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-020
- Sustituir los placeholders `VITE_FIREBASE_*` de Vercel por la configuracion Web SDK oficial de
  `jobsitejedi`, sin exponer valores en Git, logs ni documentacion.
- Reescribir rutas SPA a `/index.html` para que `/auth` y los dashboards soporten carga directa.
- Bloquear builds con variables ausentes, placeholders, proyecto incorrecto o emuladores activos.
- Autorizar `jobsitejedi.vercel.app` en Firebase Authentication para Google Sign-In.
- **Pruebas:** validador con configuracion valida/invalida, contrato de rewrite, build, carga directa
  de `/auth`, login real manager y Google interactivo.
- **Aceptacion:** produccion no muestra `auth/invalid-api-key`, `/auth` responde la SPA y la cuenta
  manager entra a `/managers`; Google no falla por dominio no autorizado.
- **Diagnostico 2026-08-28:**
  - La raiz publica respondio `200`, pero `/auth` respondio `404 NOT_FOUND`.
  - El bundle desplegado no contiene una clave web Firebase con formato valido.
  - La auditoria read-only de Vercel confirmo que las seis variables existen para Production y
    Preview, pero cada valor coincide exactamente con su propio nombre; no se mostraron valores.
  - El repositorio incorpora `vercel.json`, validacion previa al build y pruebas de regresion.
  - Evidencia local: pruebas focalizadas 7/7; suite Firebase 16 archivos/65 tests; E2E auth 1/1;
    `build`, `typecheck` y sintaxis aprobados; lint con 0 errores/7 warnings preexistentes;
    `npm audit --omit=dev` con 0 vulnerabilidades y `git diff --check` limpio.
  - Pruebas avanzadas: el contrato Vercel/Firebase cubre las seis variables, placeholders, proyecto,
    modo emulador y carga directa SPA. No aplica prueba de carga porque el cambio solo valida el
    build estatico y no agrega endpoints ni consumo por solicitud.
  - Revision de seguridad: no se versionan ni imprimen valores; el frontend no recibe secretos de
    servidor y la correccion no amplio claims ni incorporo credenciales backend.
  - Correccion remota autorizada y aplicada: las seis variables fueron recreadas como `Config`
    para Production y Preview con los valores oficiales del Web SDK; la verificacion individual
    confirmo presencia, tipo y entornos, y descarto `VITE_FIREBASE_USE_EMULATORS`.
  - `jobsitejedi.vercel.app` fue agregado y verificado en los dominios autorizados de Firebase
    Authentication. El commit `3bf789c` quedo desplegado como `Ready`; `/` y `/auth` responden 200
    con la misma entrada SPA y la pantalla de autenticacion carga sin `auth/invalid-api-key`.
  - Login productivo aprobado con la cuenta QA: Firebase autentico el claim `manager` y redirigio a
    `/managers`. La primera carga revelo que produccion aun conservaba la regla inicial `deny all`.
  - Con autorizacion del operador se desplego exclusivamente `firestore.rules` a `jobsitejedi`.
    La segunda validacion cargo proyectos y cola de revision sin errores de permisos. La prueba
    interactiva completa con identidades Google provisionadas quedo completada en T-020.

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
  - **Despliegue 2026-08-28:** el operador autorizo publicar exclusivamente `firestore.rules` en
    `jobsitejedi`; Firebase compilo y libero las reglas. La regresion productiva con el usuario
    manager confirmo lectura del dashboard sin `permission-denied`; no se desplegaron indices,
    Storage, Functions ni datos.

## Fase 2 — Primera vertical funcional Firebase

### T-005 — Crear repositorios tipados de usuarios, proyectos y trabajos

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-004
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
  - Reconciliación 2026-08-28: T-006/T-008 completaron estados, tiempo, fotos y evidencia; T-012
    confirmó cero imports Supabase bajo `src`, y la suite vigente alcanzó 16 archivos/65 tests.
    T-005 pasa a `revisión`; falta solo el cierre humano de sus criterios.

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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-003, T-004
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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-005, T-009
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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-007, T-009, T-010
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

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-005, T-006, T-007, T-008,
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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-012
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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-012
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

- **Prioridad:** P1 · **Estado:** aprobada · **Depende de:** T-012, T-014
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

- **Prioridad:** P2 · **Estado:** aprobada · **Depende de:** T-015
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

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-011, T-014
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

### T-022 — Automatizar el gate de calidad en GitHub Actions

- **Prioridad:** P0 · **Estado:** aprobada · **Depende de:** T-002
- Ejecutar CI en `push` a `main`, pull requests y disparo manual con Node 22 y JDK 21.
- Instalar dependencias con lockfiles, compilar frontend/Functions y ejecutar typecheck, lint,
  provider guard, contratos del workflow, suite Firebase y E2E contra emuladores.
- Fijar acciones oficiales a revisiones inmutables, limitar `GITHUB_TOKEN` a lectura y no incluir
  secretos, credenciales productivas, despliegues ni mutaciones remotas.
- **Pruebas:** contrato Vitest del YAML, comandos locales equivalentes y primera ejecución real de
  GitHub Actions después de publicar el workflow.
- **Aceptación:** los jobs `Quality and contracts` y `Firebase emulators and E2E` pasan en GitHub;
  el workflow no puede desplegar y queda disponible como check requerido para proteger `main`.
- **Evidencia local 2026-08-28:**
  - Contrato del workflow → 3/3; provider guard → 3/3; typecheck y build de Functions/frontend
    → aprobados; ESLint → 0 errores y 7 warnings preexistentes de Fast Refresh.
  - Firebase Auth/Firestore/Storage/Functions con Node 22.23.2 y JDK 21 → 16 archivos, 65/65
    pruebas; Playwright contra emuladores → 8/8 recorridos E2E.
  - El primer E2E detectó cuatro selectores ambiguos tras mostrar el proyecto también en el panel
    de reportes; se reemplazaron por aserciones semánticas sobre el `combobox` y la repetición
    completa pasó.
  - La revisión de seguridad confirma acciones oficiales fijadas a SHA, token de solo lectura,
    `persist-credentials: false`, proyecto demo y ausencia de secretos o comandos de despliegue.
  - La primera ejecución remota (`CI #1`) falló antes de las pruebas porque el lockfile no incluía
    `esbuild@0.28.2` y sus paquetes opcionales de Linux. Se regeneró con Node 22 y se reprodujo
    `npm ci` desde cero para raíz y Functions.
  - La instalación limpia también reveló concurrencia accidental entre seis specs: el runner quedó
    limitado a dos workers, las aserciones Firebase usan un margen acotado de 15 segundos y reporting
    filtra su propio proyecto. Sin reintentos, la suite completa volvió a pasar 8/8.
  - Ejecución remota final [`CI #2`](https://github.com/andresleosan/jobsitejedi/actions/runs/33232359171):
    `Quality and contracts` y `Firebase emulators and E2E` terminaron en `success`.
  - GitHub reportó el estado Vercel en `success`; el smoke productivo de `/auth` respondió HTTP 200,
    renderizó email/contraseña y Google, y no produjo errores de consola.
  - T-022 pasa a `revisión`; ninguna prueba de carga aplica porque este cambio no añade rutas ni
    lógica de runtime. Falta el cierre humano y configurar el check como requerido al proteger
    `main` si el operador decide habilitar branch protection.

## Fase 7 — Release controlado

### T-017 — Documentar operación y preparar staging

- **Prioridad:** P1 · **Estado:** supersedida · **Depende de:** T-013, T-015, T-016
- Crear guía de variables, emuladores, despliegue, backup, rollback, alertas de costo y
  smoke tests.
- Revisar `.env` histórico y rotar cualquier credencial que haya sido versionada.
- Preparar staging, sin desplegar producción.
- **Aceptación:** checklist operativo revisado y aprobado por el operador.
- **Avance 2026-08-29:**
  - El operador aprobo el inicio de T-017 y mantuvo produccion fuera de alcance.
  - Se documento el target aislado `jobsitejedi-staging`, variables, gate, costo, backup, rollback,
    App Check y smoke tests en `docs/staging-operations.md`.
  - `build:staging` valida que Auth, Firestore y Storage pertenezcan al proyecto de staging y
    rechaza el project ID productivo, placeholders y emuladores.
  - El proyecto `jobsitejedi-staging` y su aplicacion Web fueron creados el 2026-08-29. Blaze quedo
    vinculado con presupuesto mensual de USD 5 y alertas al 50 %, 90 % y 100 %; las alertas no son
    un limite duro. Firestore Native se creo en `eur3`, Storage privado en `europe-west1` y
    email/contrasena quedo habilitado. Produccion no fue modificada.
  - `europe-west1` queda fijada para Functions y Storage por cercania a Firestore `eur3`; decision
    registrada en `docs/adr/ADR-003-region-europea-firebase.md`.
  - La autocritica detecto que mover Functions sin mover el cliente rompia las callables. Se
    corrigio el contrato cliente/backend y la segunda vuelta aprobo: despliegue 10/10, Firebase
    16 archivos/67 tests, E2E 8/8, provider guard 3/3, typecheck, build de Functions y auditoria
    runtime con 0 vulnerabilidades; lint conserva 0 errores y 7 warnings conocidos.
  - El ruleset activo `Protect main` exige PR, bloquea borrado y force-push, no tiene bypass y
    requiere `Quality and contracts` y `Firebase emulators and E2E`.
  - Firestore/Storage Rules e indices fueron desplegados solo a staging. Las 9/9 Functions Node 22
    estan activas en `europe-west1`; el primer intento parcial 4/9 se completo idempotentemente y
    se verifico por inventario remoto. Artifact Registry elimina imagenes antiguas a los 7 dias.
  - Smoke remoto: `validateInvitationCode` responde de forma segura ante codigo invalido y
    `ensureBuilderRole` sin sesion devuelve HTTP 401 `UNAUTHENTICATED`.
  - El ruleset Storage se limpio de una funcion no usada, se revalido Firebase 67/67 y compilo
    remotamente sin warnings antes de publicarse. Quedan Google Auth, frontend staging, App Check y
    smoke funcional; el proyecto Vercel productivo no fue modificado.
  - Por instruccion del operador, la habilitacion de Google OAuth y la transferencia de la
    configuracion Web SDK a un proyecto Vercel aislado quedan pendientes de autorizacion explicita
    el 2026-08-30. Hasta entonces tampoco se ejecutan App Check ni el smoke funcional final.
  - El operador sustituyo este enfoque el 2026-08-29: no se completara un frontend separado ni se
    incorporaran usuarios o datos en staging. La consolidacion y retirada segura pasan a T-018.

### T-018 — Gate de producción

- **Prioridad:** P0 · **Estado:** en-progreso · **Depende de:** T-013, T-015, T-016, T-023, T-024,
  T-025, T-026, T-027, T-028, T-029, T-032, T-033, T-034
- Verificar seguridad sin hallazgos críticos, tests aprobados, E2E final, rollback y
  backup cuando aplique.
- Requiere confirmación explícita del operador antes de cualquier despliegue o migración.
- Consolidar reglas, índices, Storage y nueve Functions en `jobsitejedi`; conservar sus usuarios
  y configuración Auth, sin importar fixtures vacíos desde staging.
- Observar producción durante al menos siete días y eliminar `jobsitejedi-staging` solo tras un
  inventario final vacío, smoke limpio y confirmación destructiva en el momento de borrado.
- **Aceptación:** producción queda verificada y recuperable; staging solo se elimina después del
  periodo de observación y del gate destructivo final.
- **Avance 2026-08-29:**
  - Inventario oficial: staging tiene 0 usuarios, 0 colecciones Firestore y 0 archivos Storage;
    producción conserva 3 usuarios, Firestore vacío y Storage sin habilitar.
  - Ambos Firestore usan `eur3`, no hay índices compuestos y staging tiene 9/9 Functions Node 22
    activas en `europe-west1`; producción aún no tiene Functions listables.
  - Gates locales: audit runtime 0 vulnerabilidades; contratos 3/3; provider guard 3/3;
    typecheck y builds aprobados; Firebase 16 archivos/67 pruebas y E2E 8/8 aprobados.
  - Seguridad detectó que `validateInvitationCode` era pública sin límite de abuso. Se añadió
    cuota global, `maxInstances: 2`, timeout acotado y prueba de rechazo en la solicitud 31.
  - Segunda vuelta tras la corrección: build de Functions, typecheck y lint aprobados; Firebase
    16 archivos/68 pruebas y E2E 8/8 aprobados. Treinta validaciones consecutivas tardaron
    aproximadamente 33-52 ms por llamada caliente en emulador y la solicitud 31 fue rechazada.
  - El plan de despliegue, rollback, costo y retirada vive en
    `docs/firebase-consolidation-operations.md`. El gate posterior a la corrección quedó aprobado;
    el operador autorizó Blaze, la misma facturación de staging, presupuesto USD 5 y bucket en
    `europe-west1`.
  - Blaze quedó activo y el presupuesto productivo se creó por COP 16.014 (USD 5 a la TRM vigente),
    con alertas al 50 %, 90 % y 100 %. El bucket regional permanente
    `jobsitejedi.firebasestorage.app` fue verificado en `europe-west1`.
  - Firestore Rules, sus índices y Storage Rules se publicaron explícitamente a `jobsitejedi`.
    El inventario posterior confirmó 9/9 Functions Gen 2 `ACTIVE`, Node 22, en `europe-west1`;
    `ENABLE_PROJECT_CLEANUP` estuvo ausente y Auth conservó sus 3 usuarios.
  - Smoke remoto sin fixtures: invitaciones rechazó protocolo inválido con HTTP 400 y roles rechazó
    falta de sesión con HTTP 401. La SPA productiva `/auth` cargó correctamente. Los eventos graves
    revisados fueron el smoke esperado y la carrera transitoria del primer alta, resuelta por un
    reintento acotado.
  - Ese reloj quedó superado por el corte de seguridad posterior. La nueva observación comenzó el
    2026-08-31 13:55 America/Bogota; staging no se elimina antes del 2026-09-07 13:55 y aún requiere
    inventario final, smoke, revisión de costo y confirmación destructiva en ese momento.
  - El corte final dejó 9/9 Functions v4 activas, Rules coordinadas, dos usuarios autorizados con
    grants exactos, tres identidades QA deshabilitadas con tombstones y cero diferencias
    Auth↔Firestore. No hubo migración de proyectos, jobs ni archivos.
  - Artifact Registry quedó configurado para retirar imágenes de compilación con más de un día. El
    código y las revisiones Git son la fuente de rollback; `jobsitejedi-staging` sigue intacto.

## Fase 8 — Remediación priorizada de la auditoría 2026-08-30

El orden T-032 → T-026 → T-027 → T-028 → T-029 se ejecutó con la matriz de tres roles. El operador
autorizó por separado la mutación de grants, el despliegue coordinado y la publicación mediante PR.
T-029 entregó la observación sin enforcement; T-035 gobierna la decisión posterior de enforcement.
T-030 y T-031 siguen como mejoras posteriores y no bloquean el release ya desplegado.

### T-023 — Cerrar autoprovisión de roles y preparar identidades QA

- **Prioridad:** P0 crítica · **Estado:** desplegada · **Depende de:** T-003, T-015, T-020
- Retirar `ensureBuilderRole` del cliente y del backend desplegable; ninguna identidad autenticada
  puede asignarse un rol por sí misma.
- Mantener como únicas vías de autorización el consumo transaccional de una invitación válida y la
  provisión administrativa explícita. `admin` puede invitar `manager`/`builder`; `manager` solo puede
  invitar `builder`; el alta de `admin` usa exclusivamente el runbook administrativo. Revocar
  sesiones al degradar o retirar roles sensibles.
- Añadir una prueba negativa para usuario autenticado sin rol/invitación y conservar pruebas de
  consumo único, reintento idempotente y prohibición de escalamiento por `manager`.
- Crear un seeder exclusivo de Firebase Auth Emulator para `admin@admin.com` (`admin`),
  `manager@manager.com` (`manager`) y `builder@builder.com` (`builder`). La contraseña se
  recibe por variable de entorno, nunca se versiona ni se imprime.
- Documentar un runbook para auditar claims existentes. La ejecución productiva posterior solo se
  realizó tras la autorización explícita y quedó registrada sin PII ni valores de grants.
- Los scripts de asignación/revocación rechazan PII por `argv`, reciben un manifiesto JSON acotado
  por `stdin` y ligan cada `apply` a un desafío interactivo aleatorio de un solo uso y a la huella
  completa de custom claims/documento grant; repiten inventario e identidad y releen ambos estados
  antes de mutar. La escritura del grant y cualquier compensación usan precondición transaccional y
  no sobrescriben un tombstone o grant cambiado concurrentemente. El runbook exige además una
  ventana administrativa exclusiva porque Auth y Firestore no comparten una transacción. Un
  `apply` en CI o sin TTY falla cerrado. El verificador automatizado de login solo cubre el proveedor
  `password`; Google requiere login interactivo y comprobación manual equivalente. La asignación
  exige un único proveedor exacto; la revocación se ancla a correo+UID para que un cambio de providers
  no pueda bloquear la retirada de privilegios.
- **Evidencia automatizada del nuevo desafío:** 23/23 pruebas locales cubren binding de todos los
  campos, challenge fresco, claves JSON duplicadas/escapadas, cambios simulados en las huellas de
  claims/grant, CAS contra tombstones concurrentes, canarios de redacción y aislamiento de
  secretos/debug en procesos hijos. La suite no inyecta fallos en Firebase remoto ni acredita por sí
  sola todos los pasos de compensación.
- **Aceptación:** una cuenta creada sin invitación permanece sin claim y las Rules le deniegan los
  recursos protegidos; no existe callable cliente/backend de autoasignación; las invitaciones
  siguen asignando el rol correcto una sola vez; el seeder rechaza cualquier host que no sea el
  emulador y las pruebas focalizadas pasan.

### T-024 — Implementar asignación manager → builder → proyecto → job

- **Prioridad:** P0 · **Estado:** desplegada · **Depende de:** T-023, T-005
- Definir el contrato de asignación operativo: admin o manager seleccionan un builder provisionado;
  el proyecto guarda su UID asignado y cada job hereda el mismo `builderId`.
- Añadir un listado mínimo y autorizado de builders para el selector del formulario; no aceptar
  UIDs arbitrarios provenientes del frontend.
- Asegurar que un builder solo lista proyectos y jobs asignados, mientras admin/manager conservan
  administración y revisión.
- Documentar compatibilidad y rollback del campo de asignación antes de cualquier migración. No se
  aplica ninguna migración remota dentro de esta tarea.
- **Aceptación:** integración y E2E crean el proyecto desde la UI como manager, lo asignan al builder
  QA y comprueban que este lo ve; un segundo builder no lo ve y un UID inválido es rechazado.

### T-025 — Endurecer integridad operativa y jornada activa única

- **Prioridad:** P0 · **Estado:** desplegada · **Depende de:** T-004, T-006 y contrato de T-024
- Aplicar esquemas, tipos, enums, límites, referencias project/job, campos inmutables y timestamps
  canónicos en Rules para `jobs`, `jobCompletions`, `jobPhotos`, `timeTracking`,
  `projectSwitches` y firmas de riesgo.
- Reservar creación/borrado de jobs al manager; permitir al builder solo transiciones y evidencias
  correspondientes a trabajos asignados, sin reescribir datos ya revisados.
- Sustituir el patrón consulta→creación de jornada por un ID/lock determinista y transacción que
  garantice una sola jornada activa por builder.
- **Aceptación:** pruebas negativas impiden falsificar/borrar registros ajenos o canónicos y una
  carrera con solicitudes concurrentes produce exactamente una jornada activa.

#### Evidencia histórica local T-023/T-024/T-025 — 2026-08-30

- Base Git inspeccionada entonces: `107d021620f0`; esa evidencia correspondía al working tree local,
  no a un SHA desplegable. El cierre remoto vigente está en T-028/T-033/T-034.
- Autorización: se retiraron todas las superficies runtime de autoasignación; `consumeInvitation`
  queda como única ruta de alta por invitación. `test:provider-guard` pasó `8/8`.
- QA Auth Emulator (evidencia histórica previa a T-032): se crearon, autenticaron y verificaron `admin@admin.com` sin rol,
  `manager@manager.com` con `manager` y `builder@builder.com` con `builder`; la contraseña entró por
  variable temporal, no se imprimió ni se persistió.
- Asignación: callable manager-only, selector de builders provisionados, proyecto con
  `builderId == ownerId` y jobs heredando la asignación. E2E validó manager → builder seleccionado y
  denegación al segundo builder.
- Integridad: proyectos no se crean/borran directamente desde cliente; jobs, fotos, firmas,
  jornadas y cambios de proyecto tienen esquemas/transiciones/timestamps estrictos. Storage exige
  job/asignación/estado, prohíbe overwrite y bloquea evidencia tras envío/revisión.
- Gate Node `22.23.2`/JDK `21`: typecheck; lint `0` errores y `7` warnings conocidos; build; Functions
  `3/3`; Storage unit `3/3`; OCR `3/3`; contrato CI `3/3`; Firebase Emulator `17/17` archivos y
  `74/74` pruebas; Playwright Firebase `9/9`; `git diff --check` limpio.
- Web Vitals local, cinco muestras por perfil: desktop p75 LCP `196 ms`, INP `16 ms`, CLS `0`;
  móvil LCP `132 ms`, INP `16 ms`, CLS `0`.
- Auditoría runtime: cliente `0` vulnerabilidades; Functions sin altas/críticas y con `7` moderadas
  transitivas. No se aplicó el downgrade destructivo sugerido por `npm audit fix --force`.
- Pendiente histórico previo a aquel Rules/deploy: dry-run de proyectos legacy y reconciliación de
  jornadas sin marcador. El corte final no encontró ni migró proyectos/jobs; la operación remota se
  limitó a grants de usuarios autorizados y tombstones QA.

### T-032 — Incorporar rol admin y bloquear elevación de privilegios

- **Prioridad:** P0 crítica · **Estado:** desplegada · **Depende de:** T-003, T-023, T-024, T-025
- Ampliar el contrato de claims a `admin | manager | builder`; `admin` hereda las capacidades
  operativas de manager, pero la elevación a `admin` o `manager` queda reservada a admin.
- Actualizar cliente, rutas, repositorios, callables, Firestore Rules, Storage Rules, seeder y
  documentación sin introducir una segunda fuente de roles ni una callable directa de promoción.
- Probar admin permitido en operaciones manager, manager permitido solo al invitar builder,
  manager rechazado al invitar manager/admin, builder rechazado y usuario sin rol rechazado.
- Preparar el alta de `admin@admin.com` con claim `admin` exclusivamente en Auth Emulator. Cualquier
  alta o cambio de claim remoto requiere una autorización productiva separada y revocación de sesión.
- **Aceptación:** las tres identidades QA inician sesión y llegan al dashboard correcto; las reglas y
  Functions aplican mínimo privilegio; no existe escalamiento desde manager/builder; suites locales
  completas aprobadas y ADR/contrato/rollback coherentes.
- **Evidencia local 2026-08-30:** seeder verificó `admin@admin.com → admin`,
  `manager@manager.com → manager` y `builder@builder.com → builder` solo en Auth Emulator. Firebase
  pasó 17 archivos/81 pruebas y E2E 11/11; manager no puede emitir invitaciones privilegiadas.

### T-033 — Cerrar pre-hijacking e integridad de invitaciones v4

- **Prioridad:** P0 crítica · **Estado:** desplegada · **Depende de:** T-023, T-028, T-032
- [x] Deshabilitar de forma reversible las tres identidades QA compartidas en producción mientras se
  corrige el flujo; no ejecutar canjes ni reactivarlas sin una autorización productiva separada.
- [x] Retirar `createUserWithEmailAndPassword` del navegador. Crear por Admin SDK un placeholder con
  contraseña aleatoria no observable y `invitationEnrollmentId` server-side.
- [x] Rechazar toda cuenta preexistente sin marcador, verificada o no, y ligar v4 a UID, hash de
  correo, hash de enrolamiento, generación y lock exactos.
- [x] Activar contraseña mediante el password reset de Firebase con `continueUrl=/auth` fijo, sin
  código ni correo; conservar la verificación de email separada antes del consumo.
- [x] Hacer recuperable una respuesta perdida con `requestKey` de 256 bits, código cifrado AES-GCM y
  hash server-side; otro request no puede reemplazar el lock activo.
- [x] Preservar claims ajenos, retirar el marcador al asignar, releer Auth antes de confirmar y
  bloquear el script operativo si existe un enrolamiento activo.
- [x] Sacar `admin` del autoservicio; admin puede invitar manager/builder y una invitación manager
  exige autenticación de menos de cinco minutos.
- [x] Exigir un grant server-only exacto en Rules, Storage y callables; rotarlo al asignar, crear el
  grant con la confirmación de invitación y revocar de forma monotónica mediante tombstone.
- [x] Endurecer las operaciones administrativas con correo+UID+proveedor+conteo+rol anterior exactos,
  verificación Auth↔Firestore, compensación comprobada y bloqueo ante estado indeterminado.
- [x] Corregir QR para aceptar fragmento seguro, query heredada o código crudo solo en el origen
  exacto y ruta `/auth`, rechazando esquemas, hosts y payloads ambiguos.
- [x] Aprobar bajo Node 22/JDK 21: Functions unit, Auth/Firestore/Storage Emulator, provider guard,
  QR, typecheck, lint, build cliente/Functions, OCR, contratos y Playwright completo para admin,
  manager y builder, sin `console.error`, `pageerror` ni flaky aceptado.
- [x] Ejecutar autocrítica final de seguridad/QA y actualizar evidencia con conteos reales. El
  operador autorizó y se verificó el corte productivo coordinado del 2026-08-31.
- **Evidencia final 2026-08-31:** Node 22.23.2/JDK 21; Firebase Emulator 18 archivos y 133/133;
  Playwright completo 12/12, onboarding burn-in 5/5 y concurrencia focal 6/6; Functions 10/10,
  provider guard 9/9, operaciones de rol 14/14 en el SHA de aplicación, CI/Vite 4/4, OCR 3/3 y Storage
  helper 3/3. Typecheck,
  lint (0 errores/7 warnings
  históricos), build Functions y build cliente development aprobados. Auditoría: cliente 0;
  Functions 6 moderadas transitivas, 0 altas/críticas. La autocrítica no encontró vías críticas/altas.
  La compilación productiva de Vercel validó la site key oficial. El inventario posterior confirmó
  5 usuarios, 2 activos con grants exactos, 3 QA deshabilitados con tombstones y 0 diferencias; no
  se migraron proyectos/jobs. PR #4 y el CI de `main` `33433050837` quedaron verdes sobre el código
  desplegado `864335ecf4e497221469e3462a623c5211e5846e`.
- **Endurecimiento operativo posterior, aún separado de ese SHA de aplicación:** la validación local
  actual de los scripts administrativos es 23/23; su evidencia remota corresponde al PR/CI que
  publique esta revisión, no al run `33433050837`.
- **Aceptación:** el escenario pre-hijack no crea invitación ni rol; reset/login/verificación/consumo
  elimina el marcador exactamente una vez; retry devuelve el mismo código; v1-v3 fallan cerrado; una
  revocación nunca se restaura; las tres identidades QA del emulador ejercitan permisos positivos y
  negativos; todos los gates locales pasan con evidencia reproducible.

### T-034 — Estabilizar solicitudes de sesión durante logout y navegación

- **Prioridad:** P0 · **Estado:** desplegada · **Depende de:** T-028, T-033
- Descartar resultados y errores de consultas que ya no pertenecen a la sesión activa; impedir que
  respuestas fuera de orden sobrescriban el proyecto/job vigente y conservar errores reales de la
  sesión activa.
- Cubrir cierre de sesión, generaciones obsoletas y defectos de callbacks sin retries, sleeps ni
  excepciones permisivas en el fixture QA.
- **Evidencia 2026-08-31:** seis pruebas focales, onboarding 5/5, Firebase 133/133 y E2E 12/12
  pasaron localmente. PR #4 (`557caac763c8ae67ba3766d2e4958f9662afc70f`) y su CI remoto
  `33432508491` quedaron verdes; el merge `864335ecf4e497221469e3462a623c5211e5846e` repitió ambos
  jobs en `33433050837` y pasó. Vercel publicó esa revisión en producción.

### T-026 — Validar contenido de facturas y cerrar rutas Storage amplias

- **Prioridad:** P0 · **Estado:** desplegada · **Depende de:** T-023, T-025
- Detectar el tipo por bytes, validar/parsing de PDF, decodificar imágenes y generar siempre nombre
  y extensión seguros en servidor. Los archivos no verificados permanecen en cuarentena.
- Definir una estrategia de escaneo antimalware y costo antes de integrar un servicio de pago.
- Restringir `/jobs/{jobId}/manager/**` al manager y al builder realmente asignado al job.
- **Aceptación:** MIME/extensión forjados y payload no válido son rechazados; el manager solo puede
  descargar archivos aprobados y un builder no puede leer evidencias de otro.
- **Evidencia local 2026-08-30:** 7/7 tests de Functions, promoción desde cuarentena con nombre/MIME
  canónicos, rechazo de bytes forjados y contenido PDF activo, límite exacto de 10 MiB y E2E de
  envío/aprobación aprobados. Estrategia antimalware y costo documentados sin contratar servicios.

### T-027 — Corregir Vite vulnerable y endurecer desarrollo local

- **Prioridad:** P0 local · **Estado:** desplegada · **Depende de:** T-002
- Actualizar Vite a una versión corregida compatible y enlazar el servidor de desarrollo a
  `127.0.0.1` por defecto; cualquier exposición LAN debe ser una opción explícita y documentada.
- Revisar si alguna instancia vulnerable estuvo accesible desde una red no confiable; si la hubo,
  escalar al operador la rotación de credenciales potencialmente expuestas.
- **Aceptación:** auditoría sin el advisory conocido, build/typecheck/lint aprobados y prueba de que
  el servidor por defecto no escucha en interfaces externas.
- **Evidencia local 2026-08-30:** Vite `8.2.2`, plugin React SWC `4.3.3`, binding exclusivo a
  `127.0.0.1`, contrato 4/4 y build aprobado. Auditoría runtime del cliente 0 vulnerabilidades; no se
  usó `--force`.

### T-028 — Hacer reproducible y exigente el gate de QA/CI

- **Prioridad:** P1 · **Estado:** desplegada · **Depende de:** T-023, T-024, T-025, T-026, T-027
- Ejecutar CI sobre el SHA exacto; incluir unit tests de Functions, OCR, Firebase Emulator y E2E.
- Hacer fallar E2E ante `pageerror` o `console.error` no permitido, centralizar fixtures y reparar la
  configuración Playwright principal.
- Cubrir sesión expirada/revocada, pruebas concurrentes reales, límites exactos de Storage y el
  recorrido manager→builder desde UI. Publicar traces/screenshots/reportes como artefactos de CI.
- **Aceptación:** gate local Node 22/JDK 21 y CI remoto del mismo SHA pasan con evidencia y conteos
  consistentes. La ejecución remota no autoriza despliegue.
- **Avance local 2026-08-30:** CI ahora ejecuta unit tests de Functions, OCR, límites Storage,
  Firebase y E2E; verifica `GITHUB_SHA`, fija `upload-artifact` a SHA inmutable y conserva reportes.
  Playwright tiene cero reintentos, `forbidOnly`, un worker en CI y fixture central que falla ante
  `pageerror`/`console.error`. Gate final: Firebase 81/81, E2E 11/11, tipos/builds/Functions/OCR/
  Storage/contratos aprobados. El candidato `557caac763c8ae67ba3766d2e4958f9662afc70f` y el merge
  `864335ecf4e497221469e3462a623c5211e5846e` pasaron CI remoto completo en las ejecuciones
  `33432508491` y `33433050837`, respectivamente; ambas publicaron evidencia QA inmutable.

### T-029 — Incorporar App Check en observación y controles de abuso

- **Prioridad:** P1 seguridad · **Estado:** desplegada · **Depende de:** T-023, T-028
- Activar App Check en observación sin rechazar clientes legítimos; separar el eventual enforcement
  en T-035 con pruebas y autorización propias.
- Reemplazar la cuota global `public` de invitaciones por partición resistente a abuso y conservar
  un techo global de emergencia; añadir límites/lifecycle para cargas Storage.
- **Aceptación:** la clave oficial y el cliente están desplegados, Functions observa con enforcement
  desactivado, el onboarding de un usuario no puede bloquear a todos y el rollback está documentado.
- **Avance productivo 2026-08-31:** cliente desplegado con reCAPTCHA Enterprise y site key oficial;
  Functions conserva `ENFORCE_APP_CHECK=false`. La observación comenzó el 2026-08-31 13:55
  America/Bogota; cuota pública separada en 30/min por IP anonimizada y techo global 300/min. El
  eventual enforcement pasa a T-035 y no se habilita antes del 2026-09-07 13:55 ni sin evidencia de
  tráfico legítimo, pruebas de tokens y autorización productiva separada. El lifecycle de cuarentena
  también sigue pendiente de inventario y autorización propia.

### T-035 — Evaluar y habilitar enforcement de App Check

- **Prioridad:** P1 seguridad · **Estado:** en-progreso · **Depende de:** T-029
- Observar durante al menos siete días las métricas verificadas/no verificadas y errores legítimos de
  Auth, Firestore, Storage, Functions y navegador, sin usar las identidades QA productivas
  deshabilitadas.
- Probar token válido, ausente e inválido; documentar el impacto por producto y verificar el rollback
  a `ENFORCE_APP_CHECK=false` antes de cambiar una sola política remota.
- **Aceptación:** no antes del 2026-09-07 13:55 America/Bogota, métricas y QA demuestran que el tráfico
  legítimo está cubierto, el operador concede una nueva autorización productiva explícita y se
  monitorean 24 horas posteriores. La fecha por sí sola no autoriza enforcement.

### T-030 — Acotar lecturas, listeners y presupuesto de rendimiento

- **Prioridad:** P2 · **Estado:** pendiente · **Depende de:** T-024, T-025
- Añadir paginación/límites a listados, eliminar listeners N+1 de inventario y fijar presupuestos de
  lecturas, bundle y Web Vitals para flujos representativos.
- Medir con datos aislados representativos y después con RUM/producción solo cuando exista
  autorización y tratamiento de privacidad aprobado.
- **Aceptación:** consultas críticas tienen límite/cursor, no existe N+1 por solicitud y el informe
  registra p75, volumen de datos, costo estimado y regresiones del bundle.

### T-031 — Cerrar deuda documental y modularizar sin microservicios

- **Prioridad:** P2 · **Estado:** pendiente · **Depende de:** T-028
- Sustituir README/AUDITORIA/MEJORAS obsoletos de Lovable/Supabase y consolidar un manifiesto por
  release con SHA, runtimes, comandos, conteos y decisión de rollback.
- Mantener monolito modular; separar `functions/src/index.ts` e `inventory.ts` por dominio y activar
  strictness TypeScript de forma progresiva con lotes verificables.
- Actualizar Graphify después de retirar nodos obsoletos para que vuelva a ser una fuente útil.
- **Aceptación:** la documentación coincide con Firebase/Vercel vigentes, no hay runbooks
  contradictorios y cada módulo conserva sus contratos y pruebas.

### T-036 — Simplificar invitaciones y estabilizar ingreso sin correo

- **Prioridad:** P0 · **Estado:** revisión · **Depende de:** T-032, T-033, T-034
- Sustituir el tramo de password reset/verificación por un alta directa con código QR, correo
  exacto, nombre y contraseña elegida por la persona invitada.
- Mantener la creación server-side del placeholder, el mínimo privilegio, la asignación de rol
  solo al consumir la invitación y la idempotencia/rechazo de códigos antiguos.
- Validar de forma server-side el payload, aplicar rate limit, no imprimir contraseñas ni tokens y
  evitar que un código pueda activar otro correo.
- **Pruebas:** login de `admin`, `manager` y `builder` en Auth Emulator; onboarding directo
  manager → builder sin OOB/email; correo incorrecto, código usado/expirado, reintento seguro y
  rechazo de roles privilegiados desde manager.
- **Aceptación:** las tres cuentas QA llegan a su dashboard correcto; un manager puede entregar un
  código y un builder puede elegir contraseña e ingresar sin que se genere ningún correo; el grant,
  el consumo único y las reglas server-side permanecen intactos.
- **Evidencia 2026-08-31:** `test:firebase:emulator` pasó 18 archivos/131 pruebas; la E2E de
  invitación pasó 1/1 y la E2E focal de cuentas QA pasó 1/1 contra el emulador local; typecheck,
  build de Functions, build de frontend, guardas de proveedor y contrato CI pasaron. Lint quedó
  sin errores, con 7 warnings históricos de Fast Refresh.

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
- Integrado `SupplierCatalogDialog.tsx` en el dashboard manager para alta idempotente y edicion del
  nombre visible; no expone eliminacion y deja la proteccion de historial en las reglas Firestore.
- Evidencia: `npm.cmd run test:firebase:emulator` -> 15 archivos/52 tests pasados; `npm.cmd run
  typecheck`; `npm.cmd run build:functions`; `npm.cmd run build`; `npm.cmd run lint` (0 errores,
  7 warnings preexistentes); `npm.cmd run test:provider-guard` (3/3); y `git diff --check` limpio.
- El E2E de facturas fue intentado con emuladores y llego al flujo de envio/revision, pero el runner
  local quedo retenido durante el apagado; no se cuenta como aprobado y requiere repetirlo en CI o
  con el runner estabilizado.
- T-011 conserva `en-progreso`: falta extraccion OCR/entrenamiento y E2E completo; el E2E local
  requiere un runner que cierre correctamente los emuladores; no se aplicaron migraciones,
  despliegues ni cambios remotos.

## Seguimiento de T-011 - OCR local de facturas

- Integrado `tesseract.js@7.0.0` como OCR gratuito y local para imagenes; no requiere API key ni
  envia la imagen a una API de OCR.
- `src/lib/ocr/invoice.ts` extrae texto en Web Worker y propone numero, proveedor, fecha y total
  con parsing conservador; todos los campos siguen siendo editables y los PDF mantienen captura
  manual.
- `InvoiceSubmissionDialog.tsx` expone `Scan image fields`, progreso, errores visibles y fallback
  manual. La biblioteca descarga y cachea sus recursos publicos de idioma/core al primer uso.
- Evidencia: prueba unitaria del parser y fallback PDF (`3/3`), `typecheck`, `build`, `lint` (0 errores, 7
  warnings preexistentes), `test:provider-guard` (`3/3`), `build:functions` y
  `test:firebase:emulator` (`15/15` archivos, `52/52` tests) pasados. El E2E focalizado de invoices
  también pasó (`1/1`): carga de imagen, habilitación de OCR, envío privado y aprobación manager.
  La suite global fue intentada, pero el runner quedó retenido durante el teardown; no se cuenta como
  cierre global. No se aplicaron migraciones ni despliegues.

## Seguimiento de T-011 - 2026-08-28 (UI de reportes y riesgo)

- Integrado `ReportsRiskPanel.tsx` en los dashboards builder y manager: partes diarios por proyecto,
  carga privada de evaluaciones PDF, apertura del documento sin URL pública, firma idempotente y
  consulta de firmas.
- La UI conserva estados de carga, vacío y error, bloquea envíos incompletos y limita el contexto del
  manager al proyecto seleccionado; los campos y documentos siguen pasando por las validaciones y
  reglas del repositorio Firebase.
- Documentado el criterio visual de esta vertical en `STACK.md`, reutilizando los tokens existentes
  de BuildTrack Pro y una bandeja de actividad por proyecto.
- Evidencia: `typecheck`, `build`, `lint` (0 errores, 7 warnings preexistentes), `build:functions` y
  `test:firebase:emulator` (`15/15` archivos, `52/52` tests) pasaron. El E2E focalizado de invoices
  pasó su caso (`1/1`) y confirmó la superficie builder/manager; el proceso de emuladores quedó
  retenido durante teardown y fue interrumpido después del pass. T-011 conserva `en-progreso` hasta
  cubrir con E2E los envíos de reportes, carga de riesgo y firma; no hubo migraciones ni despliegues.

## Seguimiento de T-011 - 2026-08-28 (E2E de reportes y riesgo)

- El spec `tests/invoices.firebase.spec.ts` ahora cubre el flujo UI completo: builder guarda un parte
  diario, manager selecciona el proyecto, verifica la actividad, carga un PDF privado y builder vuelve
  a entrar para firmarlo; la tarjeta confirma el estado `Signed`.
- Evidencia: `npm run test:e2e:firebase -- tests/invoices.firebase.spec.ts --workers=1` dentro de
  `firebase emulators:exec` con JDK 21 pasó `1/1` en 18.1 s, junto con `typecheck` y lint sin errores.
  El runner cerró los emuladores correctamente; permanecen solo warnings no bloqueantes del entorno y
  un warning React de claves durante la suite concurrente.
- T-011 queda en `revision`: proveedores, extracción, reportes, carga privada y firma ya tienen
  implementación y evidencia E2E; falta la revisión humana de los criterios de cierre. No hubo
  migraciones ni despliegues.

## Validacion de cierre - 2026-08-28

- El gate completo esta consolidado en `docs/review-gate-2026-08-28.md`.
- Evidencia local: contratos 3/3, parser de Functions 3/3, Firebase 65/65, E2E 8/8,
  typecheck y builds aprobados, 0 vulnerabilidades de runtime y Web Vitals dentro del presupuesto.
- T-011: se corrigio una carrera de estado que podia duplicar la clave de un reporte o evaluacion;
  el E2E ahora falla si React vuelve a emitir ese warning.
- T-016: Chromium ya esta disponible y la medicion reproducible aprobo desktop y mobile. La
  evidencia detallada vive en `docs/performance-baseline.md`.
- T-022: `CI #2` paso ambos jobs en GitHub Actions. No hay rulesets activos y la integracion de
  consulta no tiene permiso administrativo para validar o cambiar la proteccion clasica de `main`.
- Seguridad: no hay hallazgos criticos. Quedan tres riesgos residuales documentados para decision
  humana: tooling de desarrollo, revocacion de la clave publicable Supabase retirada y App Check.
- El operador aprobo las 11 tareas el 2026-08-29, confirmo el aislamiento sin borrado remoto de
  Supabase, acepto temporalmente el riesgo de tooling y eligio ambos jobs de CI como checks de
  `main`. T-017 queda activa; T-018 sigue pendiente y este registro no autoriza produccion.

## Fuera de alcance hasta cerrar la Fase 2

- Nuevas features de negocio.
- Rediseño visual amplio.
- Optimización especulativa.
- Migraciones destructivas o limpieza irreversible del historial.
