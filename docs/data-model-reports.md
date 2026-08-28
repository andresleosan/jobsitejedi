# Contrato de reportes, evaluaciones y documentos privados

Este corte agrega contratos Firebase para reportes diarios y evaluaciones de riesgo. No migra
datos historicos ni aplica cambios remotos.

## Colecciones Firestore

### `dailyReports/{reportId}`

Contiene `builderId`, `projectId`, `date` (`YYYY-MM-DD`), `description`, `photoPaths` y
`createdAt`. El builder solo puede crear reportes de un proyecto cuyo `ownerId` coincide con su
claim de Auth. Los reportes son inmutables despues de crearse; manager puede leerlos.

### `riskAssessments/{assessmentId}`

Contiene `projectId`, `title`, `filePath`, `fileName`, `contentType`, `fileSize`, `uploadedBy` y
`createdAt`. Solo manager puede crear o borrar la metadata. El archivo es un PDF privado bajo
`documents/{projectId}/{assessmentId}/{fileName}`.

### `riskAssessmentSignatures/{signatureId}`

Contiene `riskAssessmentId`, `userId` y `signedAt`. El repositorio usa el ID determinista
`{riskAssessmentId}_{userId}` para que repetir la firma no genere duplicados. Solo el builder
propietario del proyecto puede firmar; no se permiten actualizaciones ni borrados.

## Reversion

El cambio es aditivo y no toca datos remotos. Para revertirlo, restaurar desde Git el repositorio,
las reglas y las pruebas. Los archivos privados creados durante pruebas se eliminan junto con el
emulador; cualquier limpieza en produccion requiere backup, plan de restauracion y confirmacion
explicita del operador.
