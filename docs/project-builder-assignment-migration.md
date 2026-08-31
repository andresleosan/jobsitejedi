# Migración de asignación proyecto → builder

Estado: plan local, no autorizado para ejecución remota.

## Contrato objetivo

Cada documento `projects/{projectId}` debe contener:

- `builderId`: UID canónico de un usuario Auth activo con claim `role=builder`.
- `ownerId`: alias transitorio igual a `builderId`, conservado mientras existan consumidores legacy.
- `createdBy`: UID del manager que creó el proyecto.
- `createdAt` y `updatedAt`: timestamps de servidor.

Cada `jobs/{jobId}.builderId` debe coincidir con `projects/{projectId}.builderId`. Un builder puede
leer y ejecutar únicamente trabajo asignado; no crea proyectos ni jobs.

## Preflight obligatorio

1. Confirmar el proyecto Firebase objetivo y registrar su ID; nunca inferirlo desde `.env`.
2. Obtener inventario de Auth y verificar que cada builder referenciado existe, está habilitado y
   conserva el claim `builder`.
3. Inventariar proyectos en cuatro grupos:
   - conformes: `builderId == ownerId` y `createdBy` válido;
   - legacy: solo `ownerId` válido;
   - conflictivos: `builderId != ownerId`;
   - inválidos: asignación ausente o usuario inexistente/deshabilitado.
4. Inventariar jobs cuyo `builderId` difiera del builder del proyecto.
5. Detenerse ante cualquier documento conflictivo o inválido; requiere resolución humana por
   proyecto, no una inferencia automática.
6. Crear y verificar un export/backup reciente de Firestore antes de cualquier escritura remota.

Si el inventario confirma cero proyectos y cero jobs, registrar esa evidencia y declarar el
backfill como operación vacía; aun así deben probarse Rules y rollback.

## Aplicación propuesta

1. Ejecutar primero un dry-run que produzca un manifiesto inmutable con ID, valores anteriores y
   valores propuestos, sin escribir.
2. Para proyectos legacy, añadir `builderId = ownerId`. `createdBy` solo se completa desde una
   asignación de manager verificada; nunca se supone que el owner/builder fue el creador.
3. Corregir jobs únicamente cuando el manifiesto humano aprobado identifique su proyecto y builder.
4. Mantener `ownerId` como alias; retirarlo es otra migración y otra autorización.
5. Aplicar en lotes pequeños e idempotentes. Cada lote vuelve a leer el documento y rechaza cambios
   concurrentes frente al valor registrado en el manifiesto.
6. Validar conteos, invariantes y accesos con manager, builder asignado, builder ajeno y anónimo.
7. Solo después proponer el despliegue de las Rules estrictas sobre el mismo SHA revisado.

## Rollback

- El manifiesto debe conservar todos los valores anteriores por documento y lote.
- Como la primera fase solo añade campos, el rollback preferido restaura los valores exactos del
  manifiesto; no elimina ni sobrescribe datos no incluidos en él.
- Si un lote queda parcialmente aplicado, reejecutar el rollback idempotente solo para sus IDs y
  repetir el inventario completo.
- Si las Rules nuevas bloquean clientes legítimos, restaurar la versión anterior de Rules desde el
  artefacto inmutable registrado; no relajar permisos manualmente desde consola.
- Una pérdida o inconsistencia que no pueda resolverse con el manifiesto exige restaurar el backup
  verificado y detener el release.

## Gate de autorización

Ningún dry-run contra datos reales, export, backfill, cambio de Rules o rollback productivo está
autorizado por este documento. Cada acción remota requiere confirmación explícita del operador,
identificando proyecto, SHA, backup y comando exactos.
