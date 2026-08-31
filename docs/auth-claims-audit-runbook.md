# Auditoría y revocación de claims de autorización

Estado: procedimiento preparado; no ejecutado contra producción.

## Modelo vigente

La aplicación admite `admin`, `manager` y `builder`. `admin` hereda las operaciones de manager y es
el único rol autorizado para emitir invitaciones `admin` o `manager`. La administración de la
infraestructura Firebase sigue siendo una capacidad externa: el claim `admin` gobierna la
aplicación, no concede IAM ni acceso a Firebase Console.

Las vías válidas para obtener autorización son:

1. consumo transaccional de una invitación vigente; o
2. provisión administrativa explícita mediante un procedimiento autorizado.

Una cuenta autenticada sin claim válido debe permanecer sin acceso a las rutas de la aplicación.

## Inventario de solo lectura

1. Registrar proyecto Firebase, fecha, operador y SHA del código que interpreta los claims.
2. Enumerar usuarios Auth sin exportar contraseñas, tokens ni factores sensibles.
3. Para cada usuario registrar únicamente UID, estado habilitado/deshabilitado, rol actual y origen
   verificable de la asignación.
4. Contrastar builders/managers con invitaciones consumidas y excepciones administrativas
   documentadas.
5. Clasificar anomalías:
   - rol distinto de `admin`/`manager`/`builder`;
   - rol sin invitación ni excepción aprobada;
   - cuenta deshabilitada con sesiones todavía válidas;
   - invitación consumida por UID diferente;
   - duplicidad o cambio de rol no documentado.
6. El inventario no cambia claims ni revoca tokens.

## Remediación propuesta

1. Preparar una lista exacta de UIDs, acción propuesta, justificación y rollback.
2. Obtener confirmación explícita del operador antes de modificar una sola cuenta productiva.
3. Quitar o corregir el custom claim mediante Admin SDK y revocar refresh tokens en la misma
   intervención operativa.
4. Verificar que los tokens anteriores dejan de autorizar y que la cuenta corregida obtiene solo el
   acceso esperado después de autenticarse de nuevo.
5. Registrar evidencia sin incluir ID tokens, refresh tokens, contraseñas ni configuración privada.

## Rollback

Restaurar únicamente el claim anterior registrado en el manifiesto aprobado y volver a revocar
refresh tokens. Si el origen del rol anterior no puede demostrarse, no se restaura automáticamente:
se escala al operador.

## Cuentas QA locales

En Firebase Auth Emulator se usan:

- `manager@manager.com`: claim `manager`.
- `builder@builder.com`: claim `builder`.
- `admin@admin.com`: claim `admin`.

La contraseña llega por `QA_TEST_PASSWORD`; el seeder debe rechazar hosts que no sean loopback y
el proyecto debe ser exactamente `demo-jobsite-jedi`. Estas cuentas nunca se crean en producción
como parte del flujo QA.
