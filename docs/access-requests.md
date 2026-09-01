# Solicitudes de acceso

## Flujo

1. El usuario crea su identidad de Firebase Auth y selecciona `admin`, `manager` o `builder`.
2. `submitAccessRequest` valida los datos y crea `accessRequests/{uid}` con estado `pending`.
3. Una cuenta con rol `admin` consulta las solicitudes mediante `listAccessRequests`.
4. `reviewAccessRequest` permite aprobar o rechazar. Aprobar escribe el grant server-only,
   actualiza los custom claims, revoca sesiones anteriores y verifica ambos registros antes de
   marcar la solicitud como `approved`.
5. El usuario inicia sesión nuevamente y recibe el rol aprobado. Una solicitud rechazada no
   concede acceso y puede volver a solicitarse.

## Modelo mínimo

`accessRequests/{uid}` contiene `schemaVersion`, `uid`, `email`, `fullName`, `phone`,
`requestedRole`, `status`, `requestedAt`, `approvalStartedAt`, `reviewedAt`, `reviewedBy`,
`decisionReason` y `updatedAt`. Los estados son `pending`, `approving`, `approved` y `rejected`.

La colección es server-only en `firestore.rules`; el cliente nunca escribe directamente ni
recibe documentos fuera de la respuesta sanitizada de las Functions.

## Reversión

La reversión de código consiste en retirar las pantallas y callables del despliegue, conservando
los documentos para auditoría. No se deben borrar solicitudes ni grants en producción como parte
de esta feature. Si una aprobación queda en `approving`, la Function falla cerrada y conserva al
usuario sin acceso hasta una revisión administrativa segura.
