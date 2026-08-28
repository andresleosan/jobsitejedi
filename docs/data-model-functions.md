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

## Compensación de invitaciones

`consumeInvitation` marca la invitación como usada dentro de una transacción. Si la asignación
del custom claim falla, una segunda transacción revierte únicamente la invitación cuyo
`usedBy` coincide con el usuario que la consumía. El usuario ya creado conserva la cuenta sin
rol y puede reintentar; no se borra la cuenta ni se exponen detalles internos del error.

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
