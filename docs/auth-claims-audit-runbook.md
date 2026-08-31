# Auditoría y revocación de claims de autorización

Estado: procedimiento ejecutado de forma controlada en producción el 2026-08-31; sigue siendo el
runbook obligatorio para futuras asignaciones y revocaciones.

## Resultado agregado del corte

- 5 usuarios Auth inventariados, sin registrar correos reales, UIDs, tokens ni valores de grants.
- 2 usuarios activos quedaron con rol y grant server-only exactos.
- 3 identidades QA compartidas quedaron deshabilitadas, sin claims de aplicación y con tombstones
  `active:false`.
- 5 documentos de grant: 2 activos y 3 inactivos; 0 diferencias Auth↔Firestore.
- Se revocaron sesiones cuando aplicaba y se releyó el estado final. No hubo estado indeterminado.

La ejecución no creó ni migró proyectos, jobs o archivos. Una identidad QA deshabilitada no se
reactiva como rollback; recuperar acceso es una asignación nueva, autorizada y con grant rotado.

Recibo auditable redactado: [`evidence/production-auth-cutover-20260831.json`](evidence/production-auth-cutover-20260831.json),
Git blob `8d4ea8364b81305b78e10e1517a07e55917ce532`. Registra fecha, referencia de autorización, revisión
del código, release, CI y agregados finales sin incorporar PII ni material de autenticación.

## Modelo vigente

La aplicación admite `admin`, `manager` y `builder`. `admin` hereda las operaciones de manager y
puede emitir invitaciones `manager` o `builder`; manager solo invita builder. El alta de admin usa
exclusivamente la provisión administrativa explícita. La administración de la
infraestructura Firebase sigue siendo una capacidad externa: el claim `admin` gobierna la
aplicación, no concede IAM ni acceso a Firebase Console.

Las vías válidas para obtener autorización son:

1. consumo transaccional de una invitación vigente; o
2. provisión administrativa explícita mediante un procedimiento autorizado.

Firestore y Storage Rules comparan el ID token con `authorizationGrants/{uid}` activo; no pueden leer
el UserRecord de Auth. Los callables comparan además token, UserRecord vigente, sesión y documento.
La colección es server-only y cualquier ausencia o diferencia falla cerrado. Por esta asimetría,
deshabilitar una cuenta o editar claims solo desde Firebase Console no invalida inmediatamente un ID
token frente a Rules: no sustituye la rotación/tombstone del script autorizado.

## Inventario de solo lectura

1. Registrar proyecto Firebase, fecha, operador y SHA del código que interpreta los claims.
2. Enumerar usuarios Auth sin exportar contraseñas, tokens ni factores sensibles.
3. Para cada usuario registrar únicamente UID, estado habilitado/deshabilitado, rol actual, presencia
   y coincidencia del grant y origen verificable de la asignación. No copiar el valor del grant al
   informe compartido.
4. Contrastar builders/managers con invitaciones consumidas y excepciones administrativas
   documentadas.
5. Clasificar anomalías:
   - rol distinto de `admin`/`manager`/`builder`;
   - rol sin invitación ni excepción aprobada;
   - cuenta deshabilitada con sesiones todavía válidas;
   - `authorizationGrantId` ausente, mal formado o distinto del documento server-side;
   - grant ausente, inactivo con rol presente, rol distinto o campos adicionales;
   - invitación consumida por UID diferente;
   - placeholder con `invitationEnrollmentId` sin invitación v4 vigente o con rol asignado;
   - duplicidad o cambio de rol no documentado.
6. El inventario no cambia claims ni revoca tokens.

## Remediación propuesta

1. Preparar una lista exacta de UIDs, acción propuesta, justificación y rollback.
2. Obtener confirmación explícita del operador y una ventana exclusiva antes de modificar una sola
   cuenta productiva: una operación por vez, sin cambios paralelos desde Console, otro host o job.
3. Para asignar o corregir, exigir siempre correo, UID, proveedor único, conteo y rol anterior exactos.
   El script bloquea cuenta deshabilitada, email no verificado o `invitationEnrollmentId` activo. La
   revocación se ancla a correo+UID y no puede ser bloqueada por cambios en proveedores vinculados.
4. Rotar conjuntamente `authorizationGrantId` en Auth y el documento activo server-side. El grant se
   cambia primero mediante una transacción con precondición de huella exacta para no pisar un cambio
   concurrente; luego se verifica Auth↔Firestore y se revocan refresh tokens best-effort.
5. Para revocar, escribir y releer primero un tombstone `active:false`, retirar los tres claims de
   autorización/enrolamiento y revocar tokens. Nunca borrar el tombstone ni compensar restaurando
   privilegios. Un doble fallo que impida confirmar el tombstone bloquea producción como estado
   indeterminado.
6. Verificar token nuevo, Auth actual, grant, lectura protegida y ruta UI; confirmar además que el
   token anterior queda denegado aun cuando conserve el mismo rol.
7. Registrar evidencia sin incluir valores de grants, ID tokens, refresh tokens, contraseñas ni
   configuración privada.

## Rollback

Una asignación fallida restaura claims y documento previos solo si ambos pueden releerse exactamente;
de lo contrario deja un tombstone verificado o declara estado indeterminado. Una revocación no tiene
rollback automático: restaurar privilegios es una asignación nueva, con autorización explícita y un
grant nuevo. Si el origen del rol anterior no puede demostrarse, se escala al operador.

## Cuentas QA locales

En Firebase Auth Emulator se usan:

- `manager@manager.com`: rol `manager` y grant local vigente.
- `builder@builder.com`: rol `builder` y grant local vigente.
- `admin@admin.com`: rol `admin` y grant local vigente.

La contraseña llega por `QA_TEST_PASSWORD`; el seeder debe rechazar hosts que no sean loopback y
el proyecto debe ser exactamente `demo-jobsite-jedi`. El flujo QA no crea ni reactiva cuentas en
producción. Los homólogos compartidos que ya existen allí permanecen deshabilitados y sin acceso.
