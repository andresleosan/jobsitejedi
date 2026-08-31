# Migración de jornadas activas al marcador determinista

## Objetivo

`activeTimeEntries/{builderId}` es el lock canónico que garantiza una sola jornada abierta por
builder. Este documento prepara la migración de registros anteriores; no autoriza ejecutar nada en
staging o producción.

## Preflight obligatorio

1. Obtener autorización separada para leer el entorno objetivo y generar un inventario sin datos
   sensibles en logs.
2. Verificar backup/export recuperable de `timeTracking` y `activeTimeEntries`.
3. Listar `timeTracking` con `clockOut == null`, agrupado por `builderId`.
4. Detenerse si un builder tiene más de una entrada abierta. Ese conflicto exige una decisión
   humana sobre cuál conservar y cómo cerrar las demás; no se resuelve por fecha implícitamente.
5. Comprobar que cada entrada abierta apunta a un proyecto canónico asignado al mismo builder
   (`project.builderId == project.ownerId == timeEntry.builderId`).

## Dry-run

Generar, sin escrituras, una tabla con:

- `builderId`, `entryId`, `projectId` y existencia del proyecto;
- cantidad de entradas abiertas del builder;
- marcador actual, si existe, y si coincide con la entrada;
- acción propuesta: `create-marker`, `already-canonical`, `stale-marker` o `manual-conflict`.

El dry-run debe producir cero `manual-conflict` y cero proyectos inconsistentes antes de continuar.

## Aplicación por lotes

1. Mantener bloqueadas nuevas jornadas durante la ventana de migración.
2. Por cada caso `create-marker`, ejecutar una transacción que relea la entrada y confirme que
   `clockOut` sigue en `null`, que no apareció otro marcador y que la asignación continúa válida.
3. Crear `activeTimeEntries/{builderId}` con `builderId`, `entryId`, `projectId` y timestamp de
   servidor en `updatedAt`.
4. Para `stale-marker`, detenerse salvo que el backup, la entrada cerrada y la entrada abierta única
   demuestren de forma inequívoca cuál es el marcador correcto.
5. Repetir el inventario y comprobar exactamente un marcador por builder con jornada abierta, y
   ningún marcador para builders sin jornada abierta.

## Rollback

Antes de aplicar, conservar un manifiesto de los IDs de marcador creados o corregidos y su valor
anterior. Si falla la verificación:

1. mantener bloqueadas nuevas jornadas;
2. restaurar solo esos documentos desde el manifiesto/export;
3. repetir el inventario y confirmar que `timeTracking` no fue alterado;
4. retirar el bloqueo únicamente después de revisión humana.

No se despliegan las Rules estrictas ni se aplica esta migración hasta recibir autorizaciones
separadas para backup, migración y despliegue.
