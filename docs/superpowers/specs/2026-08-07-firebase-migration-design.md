# Migracion a Firebase desde cero

## Estado

Diseño aprobado por el operador. Este documento define una instalación nueva de Firebase que conserva la funcionalidad actual y los roles `manager` y `builder`. No incluye importación de datos históricos porque no existe acceso al proyecto Supabase actual.

## Objetivo

Reemplazar Supabase por Firebase sin cambiar la experiencia funcional del frontend:

- Autenticación y sesión.
- Roles, invitaciones y protección de rutas.
- Proyectos, trabajos, completados, colaboradores y seguimiento de tiempo.
- Materiales, inventario, herramientas y solicitudes.
- Facturas, extracción de datos y reportes.
- Fotos, documentos, notas de voz y thumbnails.
- Solicitudes de recogida de residuos.
- Actualizaciones en tiempo real.

## No objetivos

- Migrar usuarios, documentos, registros o archivos existentes de Supabase.
- Mantener una capa de compatibilidad con la API de Supabase.
- Ejecutar despliegues o crear el proyecto Firebase sin acceso y confirmación operativa.
- Resolver en esta fase vulnerabilidades no relacionadas con la migración.

## Arquitectura

El frontend React/Vite existente seguirá siendo la aplicación principal. Se añadirá una capa de infraestructura en `src/lib/firebase/` y los componentes dejarán de acceder directamente a proveedores de datos.

Servicios:

- Firebase Auth para email/password, recuperación y sesión.
- Cloud Firestore para datos de negocio.
- Firebase Storage para archivos privados.
- Cloud Functions para operaciones privilegiadas, procesamiento y tareas programadas.
- Firebase Emulator Suite para desarrollo y pruebas locales.

La configuración se leerá desde variables `VITE_FIREBASE_*` en `.env`. Ninguna credencial se incluirá en el repositorio.

## Roles y autenticación

- `users/{uid}` almacenará perfil, nombre y rol auxiliar.
- El rol efectivo se expresará en custom claims `manager` o `builder`.
- Una Cloud Function administrará invitaciones de managers y asignación de claims.
- El registro público creará builders; la creación de managers requerirá invitación válida.
- Las rutas protegidas comprobarán la sesión y el rol antes de montar módulos sensibles.
- Las reglas Firestore y Storage comprobarán `request.auth` y los claims; no confiarán únicamente en el frontend.

## Modelo Firestore

Se usarán colecciones planas con referencias por ID para facilitar consultas, listeners y reglas:

`users`, `projects`, `jobs`, `jobCompletions`, `jobPhotos`, `jobMaterials`, `materials`, `materialUsage`, `storageMaterials`, `invoices`, `invoiceItems`, `suppliers`, `invoiceExtractionTraining`, `dailyReports`, `dailyReportPhotos`, `riskAssessments`, `riskAssessmentSignatures`, `rubbishRequests`, `timeTracking`, `collaborators`, `toolRequests`, `toolCheckouts` e `invitations`.

Cada documento conservará IDs explícitos (`projectId`, `jobId`, `userId`, `createdBy`, `uploadedBy`) y timestamps Firestore. Los datos de archivos guardarán rutas, no URLs públicas.

## Storage

Todos los archivos serán privados y se accederá a ellos mediante el SDK mientras la sesión esté autorizada:

- `job-photos/{jobId}/{file}`
- `job-completion-photos/{completionId}/{file}`
- `daily-report-photos/{uid}/{reportId}/{file}`
- `invoices/{uid}/{file}`
- `documents/{projectId}/{file}`
- `storage-material-photos/{materialId}/{file}`
- `rubbish-photos/{uid}/{requestId}/{file}`
- `job-voice-notes/{uid}/{file}`
- `job-review-voice-notes/{jobId}/{file}`

Las rutas se persistirán en Firestore. Las URLs de descarga solo existirán en memoria y tendrán manejo explícito de errores.

## Capa de código

- `src/lib/firebase/client.ts`: inicialización de Auth, Firestore y Storage.
- `src/lib/firebase/auth.ts`: sesión, login, registro, logout y recuperación.
- `src/lib/firebase/repositories/`: repositorios por dominio.
- `src/lib/firebase/storage.ts`: upload, descarga, thumbnails y acceso temporal.
- `src/lib/firebase/functions.ts`: cliente de Cloud Functions y errores normalizados.
- `src/hooks/useAuth.ts`: sesión y rol actual.

Los componentes conservarán la UX actual. La lógica de consulta, autorización, normalización y errores quedará en repositorios y servicios.

## Cloud Functions

Se implementarán como funciones separadas:

- `createManagerInvitation`.
- `setUserRole`.
- `processInvoice`.
- `extractJobsFromExcel`.
- `cleanupOldProjects`.
- `createSignedFileAccess` solo si una pantalla necesita una mediación adicional para archivos.

Las funciones validarán entradas, autenticación y rol. Las integraciones externas tendrán límites de tiempo, errores normalizados y reintentos finitos con backoff.

## Tiempo real y errores

- `onSnapshot` sustituirá las suscripciones `postgres_changes`.
- Cada listener se desmontará al abandonar la pantalla.
- Las escrituras no reintentarán indefinidamente.
- Los errores de red mostrarán mensajes accionables sin exponer detalles internos.
- Se evitarán escrituras parciales mediante operaciones batch o transacciones cuando varias entidades deban cambiar juntas.

## Fases de implementación

1. Añadir Firebase SDK, configuración local y Emulator Suite.
2. Implementar Auth, claims, usuarios y guards de rutas.
3. Implementar repositorios Firestore y reglas de seguridad.
4. Implementar Storage privado y migrar uploads/descargas del frontend.
5. Implementar Functions para invitaciones, Excel, facturas y limpieza.
6. Reemplazar listeners y consultas de cada módulo.
7. Eliminar imports y dependencias funcionales de Supabase.
8. Ejecutar pruebas de reglas, integración, E2E, lint y build.
9. Con acceso al proyecto, desplegar primero a staging y verificar manualmente.

## Pruebas y aceptación

- Unit tests para repositorios, Auth y Storage.
- Firebase Emulator Suite para Auth, Firestore, Storage y Functions.
- Tests de Rules para anónimo, builder, manager, propietario y usuario ajeno.
- E2E para login, proyectos, trabajos, fotos, facturas, documentos, inventario y residuos.
- Build de producción sin errores.
- Ningún archivo sensible accesible sin sesión y autorización.
- Ninguna operación privilegiada ejecutable directamente desde un cliente no autorizado.

## Costos y operación

El desarrollo local usará emuladores sin costo remoto. Producción puede requerir plan Blaze por Cloud Functions y Storage. Antes de desplegar se debe configurar alerta presupuestaria y límite operativo. El costo depende de lecturas/escrituras Firestore, almacenamiento, descargas, invocaciones y procesamiento externo de facturas.

## Rollback

Antes del primer despliegue, conservar la versión anterior del frontend y de las reglas/functions Firebase. El rollback de aplicación consiste en volver a publicar el frontend anterior y restaurar las reglas/functions anteriores. Como la instalación Firebase será nueva y no se importarán datos, no existe rollback de una migración histórica de datos.

## Criterio de salida

La migración se considerará lista solo cuando el proyecto Firebase tenga acceso operativo, las reglas pasen en Emulator Suite, las pruebas E2E pasen contra staging y el operador confirme el despliegue.
