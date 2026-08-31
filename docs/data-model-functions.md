# Contrato de control para Cloud Functions

Estado: implementado en local, sin despliegue ni migración de producción.

## `functionRateLimits/{hash}`

Colección administrativa escrita únicamente por Cloud Functions. El identificador es un
SHA-256 de `operación:uid`, por lo que no expone el UID en la ruta. Cada documento contiene:

| Campo | Tipo | Uso |
| --- | --- | --- |
| `operation` | string | Callable protegido al que aplica el límite. |
| `windowStartedAt` | timestamp | Inicio de la ventana vigente. |
| `requestCount` | integer | Solicitudes aceptadas dentro de la ventana. |
| `updatedAt` | timestamp | Marca para limpieza programada. |

Las reglas Firestore mantienen esta colección fuera del acceso de clientes. Los límites son
por usuario y operación; la limpieza elimina documentos sin actividad durante 24 horas.

## `authorizationGrants/{uid}`

Registro administrativo server-only que convierte la revocación en inmediata para Rules y
Functions, sin depender de que un ID token cacheado expire. El cliente no puede leerlo ni escribirlo.

| Campo | Tipo | Uso |
| --- | --- | --- |
| `active` | boolean | Solo `true` autoriza; `false` es un tombstone que no se elimina. |
| `role` | `admin \| manager \| builder` | Debe coincidir con token y UserRecord actual. |
| `grantId` | string hexadecimal de 32 caracteres | Coincide con `authorizationGrantId` en ambos claims. |
| `updatedAt` | timestamp | Evidencia operativa y requisito de integridad. |

El documento admite exclusivamente esos cuatro campos. `isSignedIn()` en Firestore/Storage exige el
match completo; los callables además releen Firebase Auth y comprueban sesión no revocada. Rotar el
grant invalida tokens anteriores aunque conserven el mismo rol. Revocar escribe primero
`active:false`, luego retira claims; el tombstone evita que una carrera o retry reactive permisos.

El rollout tiene migración aditiva: con la versión antigua aún activa se crean claims/documentos para
todos los usuarios autorizados. Solo después se despliegan conjuntamente Functions y Rules nuevas.
No hay backfill cliente ni fallback a `role` solamente.

## Invitaciones v4, idempotencia y compensación

`invitationTargets/{targetLockHash}` serializa las invitaciones de un correo sin almacenar ese correo
en claro. Cada lock referencia una sola invitación y replica `requestKeyHash`, `generation`, estado y
expiración. La invitación conserva `codeHash`, el código cifrado con AES-GCM, hashes de email y
enrolamiento, `targetUid` y la máquina `not_started → pending → completed|failed`.

La clave aleatoria de idempotencia no se persiste en claro. Una respuesta perdida puede recuperarse
solo presentando de nuevo esa misma clave; el servidor descifra el código, comprueba su hash y devuelve
la expiración original. Una clave diferente no reemplaza un lock activo.

`consumeInvitation` reserva el consumo dentro de una transacción. Si `setCustomUserClaims` falla antes
de escribir el rol, una compensación revierte únicamente la invitación cuyo `usedBy` coincide. Si el
rol y el grant ya quedaron en Auth pero la confirmación Firestore falló, el retry puede finalizar
dentro de dos minutos. Antes de confirmar se relee Auth y se exigen rol, grant y marcador exactos. La
transacción crea —no sobrescribe— el grant junto con el estado completado; un documento previo impide
la recuperación. Los estados inconsistentes o fuera de ventana fallan cerrado y requieren
recuperación administrativa; un código completado nunca repone un rol o grant revocados.

Auth y Firestore no ofrecen una transacción común. Si el proceso cae entre crear el placeholder y
guardar su custom claim puede quedar una identidad sin marcador: el sistema la rechaza y no la adopta.
Los placeholders no se eliminan automáticamente y jamás obtienen acceso por el mero marcador.

## Limpieza de proyectos

La función programada limpia invitaciones expiradas y límites inactivos en cada ejecución.
El borrado de proyectos está desactivado por defecto y solo considera proyectos `finished`
con `cleanupEligibleAt` anterior a 30 días, sin registros relacionados. Requiere además
`ENABLE_PROJECT_CLEANUP=true`; una ausencia o cualquier otro valor deja intactos los datos de
negocio.

Antes de habilitar el borrado en un entorno real se requiere backup verificable, prueba de
restauración, revisión de candidatos y confirmación explícita del operador. El rollback
operativo es deshabilitar la variable y detener la función; la recuperación de documentos
borrados depende del backup verificado.

## Importación de trabajos

`extractJobsFromExcel` acepta archivos `.xlsx`, `.csv` y `.tsv` subidos por un manager a
`job-imports/{managerId}/{fileName}`. El parser no evalúa fórmulas y limita el archivo a 5 MiB,
500 filas, 16 columnas y 2.000 caracteres por celda. El contrato mínimo reconoce columnas
`Title`/`Job`/`Task`, con `Description` y `Section` opcionales.

Cada importación se identifica con SHA-256 del manager, proyecto y contenido, sin depender del
nombre temporal del archivo. Se registra en `jobImports/{importId}` y genera IDs deterministas en
`jobs/`, por lo que un reintento —incluso después de volver a subir la misma hoja— devuelve los
mismos `createdJobIds` sin duplicar trabajos. El documento de importación conserva metadata y
estado, no el archivo crudo. Los archivos fuente quedan privados y no se borran automáticamente.

Si falla la escritura, la importación queda `failed` y puede reintentarse después de expirar el
lock de 10 minutos. No se modifica el proveedor legado ni se aplica ninguna migración remota.
