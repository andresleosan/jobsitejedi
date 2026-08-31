# Operacion controlada de roles de Firebase Auth

## Contrato vigente desde T-032 — 2026-08-30

Los roles de aplicación son `admin`, `manager` y `builder`. `admin` hereda la operación de manager,
puede invitar managers y builders, y manager solo puede invitar builders. El alta de otro `admin`
queda fuera del autoservicio: usa exclusivamente el procedimiento administrativo auditado de este
documento. Crear una invitación de manager exige autenticación de menos de cinco minutos.

El operador solicitó que `admin@admin.com` tenga claim `admin`, pero esa solicitud se implementa y
verifica primero en Auth Emulator. Cambiar la cuenta remota requiere un manifiesto con proyecto,
UID/correo/proveedor exactos, rol y grant anteriores, estado propuesto, conteo total esperado,
revocación de refresh tokens y rollback, seguido de una autorización de producción independiente.

## Contención y contrato de invitaciones v4 — 2026-08-31

Durante la preparación del QA productivo se detectó que las Rules permitían a un manager listar
documentos de `invitations` y que `consumeInvitation` aceptaba el ID del documento sin volver a
comprobar el código. Las tres identidades QA compartidas quedaron inhabilitadas de forma reversible
en Firebase Authentication. No se ejecutó el escenario de escalamiento ni se desplegó una corrección.

La revisión posterior encontró además un pre-hijacking: crear la cuenta en el navegador permitía a
quien conociera código y correo elegir una contraseña antes de que el destinatario verificara el
email. El contrato local v4 elimina esa creación cliente y queda definido así:

- `createManagerInvitation({ role, targetEmail, requestKey })` relee al actor y la revocación de su
  sesión. Precrea con Admin SDK una identidad placeholder con contraseña aleatoria que nunca se
  devuelve, guarda ni registra, y le añade únicamente `invitationEnrollmentId` server-side.
- Se rechaza toda cuenta preexistente sin ese marcador, incluso si está verificada o no tiene rol.
  Una identidad antigua sin procedencia comprobable se resuelve por el runbook administrativo, no
  se adopta desde autoservicio.
- El documento usa `schemaVersion: 4`, liga UID, hash de email, hash de enrolamiento, generación,
  rol y lock por destino. El código solo se guarda como hash y cifrado AES-GCM; la clave de
  idempotencia de 256 bits permanece en el cliente y en Firestore solo queda su hash.
- Repetir la misma solicitud recupera el mismo código y expiración; otra solicitud al mismo correo
  recibe `already-exists`. El lock y la invitación deben coincidir también en generación.
- `requestInvitationActivation` valida código y correo antes de pedir a Firebase un password reset.
  Su `continueUrl` es `/auth` fijo: no contiene correo ni código. El destinatario fija la contraseña,
  inicia una sesión nueva y completa por separado la verificación del correo si sigue pendiente.
- `consumeInvitation({ code })` relee Auth, exige cuenta activa, email verificado, sesión no revocada,
  UID/email/enrolamiento/generación exactos y máquina de estados recuperable. Al asignar preserva
  claims ajenos, elimina `invitationEnrollmentId`, crea un `authorizationGrantId` aleatorio y
  confirma atómicamente el registro server-only `authorizationGrants/{uid}` con la invitación.
- Una invitación completada nunca restaura un rol retirado. El script operativo rechaza identidades
  con enrolamiento activo para no competir con la asignación. Un retry solo acepta un grant activo
  exacto ya completado; la transición pendiente usa `create`, por lo que nunca reactiva un tombstone.
  Firestore niega al cliente cualquier acceso a invitaciones, locks y grants.

No hay migración ni backfill: invitaciones v1, v2 y v3 fallan cerrado y deben reemitirse. Los
placeholders vencidos permanecen sin rol y sin acceso; su limpieza futura requiere un procedimiento
separado que compruebe UID y marcador exactos. No se eliminan automáticamente usuarios Auth.

## Orden obligatorio de migración y despliegue futuro

Las Rules nuevas niegan si token y documento no coinciden; Functions exige además Auth y sesión
vigentes. Por eso no se despliegan antes del backfill:

1. Mantener deshabilitadas las identidades QA remotas y congelar altas/cambios de rol.
2. Inventariar cada usuario autorizado y aprobar por separado el manifiesto productivo exacto.
3. Con el código antiguo todavía activo, ejecutar el dry-run y luego la asignación dirigida para cada
   usuario activo. Esto rota `authorizationGrantId`, escribe el grant activo y conserva otros claims.
4. Verificar claim y documento con Admin SDK; avisar que habrá cierre de sesión y nueva autenticación.
5. Desplegar desde el mismo SHA Functions, Firestore Rules y Storage Rules durante una ventana de
   mantenimiento. No desplegar una sola capa ni continuar si un usuario autorizado quedó sin grant.
6. Desplegar el cliente del mismo SHA, exigir login nuevo y ejecutar una lectura protegida y los
   positivos/negativos de cada rol. Solo después se habilita tráfico normal.
7. Una activación QA remota temporal sigue necesitando autorización separada. El password reset y el
   dominio exacto deben estar habilitados en Firebase Auth.

Rollback seguro: no restaurar v1-v3, no reabrir lecturas y no borrar placeholders. Se deshabilita la
creación/consumo v4, se mantienen Rules con grants y se corrige hacia adelante. Revertir solo la UI es
seguro; revertir Functions o Rules al contrato basado únicamente en `role` reautorizaría tokens
obsoletos y tombstones, por lo que está prohibido.

## Auditoria de solo lectura - 2026-08-28

Proyecto auditado: `jobsitejedi`.

- Usuarios totales: 1.
- Usuarios activos: 1.
- Usuarios deshabilitados: 0.
- Claim `manager`: 0.
- Claim `builder`: 0.
- Sin rol de aplicacion: 1.
- Proveedor de la unica cuenta: email/contrasena.

No se guardaron tokens, contrasenas, UID ni datos personales en el repositorio. Tampoco se
modifico Firebase. Como no existe otro manager, asignar `manager` a esta cuenta seria el
bootstrap inicial de privilegios y requiere confirmacion explicita del operador.

## Aplicacion controlada - 2026-08-28 (registro histórico anterior al grant)

El operador autorizo asignar `manager` al unico usuario activo de `jobsitejedi`.

- Dry-run: 1 usuario activo y rol anterior `null`.
- Cambio: se preservaron los demas custom claims y se asigno solo `role: manager`.
- Verificacion Admin: Firebase devolvio `role: manager` inmediatamente despues de escribir.
- Login real: email/contrasena aceptados y el ID token firmado fue verificado contra Firebase.
- Smoke UI real: la aplicacion termino en `/managers` y no mostro el estado de rol faltante.
- Credenciales: entrada segura en memoria; no se guardaron en argumentos, archivos, capturas o logs.
- Despliegues: ninguno.

## Asignaciones Google dirigidas - 2026-08-28 (registro histórico anterior al grant)

El operador autorizo `manager` para dos identidades Google concretas despues de que cada persona
completara Google Sign-In y Firebase creara su usuario sin rol.

- Estado previo: 3 usuarios totales; la cuenta QA por contrasena ya era `manager` y las dos
  identidades Google tenian rol `null`.
- Cada operacion exigio correo exacto, proveedor `google.com`, conteo total esperado y confirmacion
  ligada al proyecto, identidad y rol.
- Los dos dry-runs verificaron identidad unica, proveedor y rol anterior sin escribir.
- Cada aplicacion preservo los claims existentes, escribio solo `role: manager` y releyo Firebase
  para confirmar el resultado.
- Las dos cuentas Google completaron el acceso interactivo normal. El operador confirmo que la
  segunda cuenta puede ingresar y cerrar sesion sin problemas despues de renovar su ID token.
- El script captura errores del SDK y emite solo codigo y mensaje sanitizados; no imprime objetos
  de transporte, encabezados de autorizacion ni tokens temporales.
- Verificacion final: el dry-run remoto devolvio `manager` sin escribir; la regresion de fallo
  controlado termino con codigo 1, una sola linea sanitizada y cero patrones de token.

## Precondiciones para asignar un rol

1. El operador confirma la identidad objetivo, el rol exacto (`admin`, `manager` o `builder`) y autoriza
   la mutacion en `jobsitejedi`.
2. Siempre se exigen correo, UID y proveedor exactos, email verificado, cuenta habilitada, ausencia de
   `invitationEnrollmentId` y conteo total esperado. No existe el modo “único usuario activo”.
3. Se vuelve a leer el usuario inmediatamente antes del cambio y se conserva fuera del repositorio
   una copia de claims y grant actuales para compensación.
4. `--expected-current-role` es obligatorio incluso si coincide con el rol solicitado; `none`
   representa ausencia de rol. La confirmación queda ligada a proyecto, acción, correo, UID,
   proveedor, rol anterior y rol nuevo.
5. La operación escribe primero un grant nuevo para invalidar tokens anteriores, preserva claims no
   relacionados y asigna `role` + `authorizationGrantId`. Después relee Auth y Firestore exactamente.
6. Si la verificación falla, restaura el estado previo y lo relee. Si no puede probar la compensación,
   exige y verifica un tombstone `active:false`; si tampoco puede, declara estado indeterminado y
   bloquea el despliegue.
7. La persona inicia una sesión nueva. `verify-single-firebase-login.mjs` debe comprobar token, Auth,
   grant server-side, ruta UI y una lectura Firestore protegida; validar solo el dashboard no basta.

Plantilla de dry-run (sin contraseña ni secretos en argumentos):

```text
npm run firebase:role:assign -- --project=jobsitejedi --email=<exacto> --uid=<exacto> --provider=<exacto> --expected-users=<auditado> --expected-current-role=<none|admin|manager|builder> --role=<admin|manager|builder>
```

La aplicación añade `--apply=true` y un `--confirm=` construido exactamente como
`jobsitejedi:assign:email:<correo>:uid:<uid>:provider:<proveedor>:current:<rol-anterior>:role:<rol-nuevo>`.
La contraseña para el smoke se entrega solo por `FIREBASE_QA_PASSWORD` en memoria.

## Revocación monotónica

`npm run firebase:role:revoke` requiere el mismo binding exacto y el rol actual auditado. Primero
escribe y relee `authorizationGrants/{uid}` con `active:false`; después retira `role`,
`authorizationGrantId` e `invitationEnrollmentId`, y revoca refresh tokens. Nunca borra el documento
ni restaura un grant activo como compensación. Un error que no permita confirmar el tombstone deja el
estado “indeterminado”, bloquea producción y exige inspección manual antes de continuar.

## Rollback

Una asignación fallida puede restaurar claims y grant anteriores únicamente si ambos se verifican.
Una revocación iniciada no se revierte automáticamente: se conserva el tombstone y cualquier
restauración de privilegio se trata como una nueva asignación con nueva autorización y grant rotado.

No eliminar ni deshabilitar usuarios como parte de este rollback. Cualquier despliegue de codigo,
cambio masivo o limpieza de identidades necesita un procedimiento y una autorizacion separados.
