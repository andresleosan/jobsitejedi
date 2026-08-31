# Operacion controlada de roles de Firebase Auth

## Contrato vigente desde T-032 — 2026-08-30

Los roles de aplicación son `admin`, `manager` y `builder`. `admin` hereda la operación de manager,
puede invitar managers y builders, y manager solo puede invitar builders. El alta de otro `admin`
queda fuera del autoservicio: usa exclusivamente el procedimiento administrativo auditado de este
documento. Crear una invitación de manager exige autenticación de menos de cinco minutos.

El perfil QA administrativo se implementó y verificó con claim `admin` en Auth Emulator. Las tres
identidades QA compartidas que ya existían en producción no conservan ese acceso: el corte del
2026-08-31 las dejó deshabilitadas, sin claims de aplicación y con tombstones inactivos. Una
reactivación remota exige credenciales individuales, manifiesto con proyecto, UID/correo/proveedor
exactos, rol y grant anteriores, conteo esperado, revocación de sesiones, rollback y autorización de
producción independiente.

## Contención y contrato de invitaciones v4 — 2026-08-31

Durante la preparación del QA productivo se detectó que las Rules permitían a un manager listar
documentos de `invitations` y que `consumeInvitation` aceptaba el ID del documento sin volver a
comprobar el código. Las tres identidades QA compartidas quedaron inhabilitadas de forma reversible
en Firebase Authentication. El escenario positivo se conservó en Emulator; después de remediar el
contrato, el operador autorizó la reconciliación exacta de usuarios activos y el despliegue
coordinado.

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
- `activateInvitation` valida en servidor el código de un solo uso, el correo exacto y el marcador de
  enrolamiento antes de fijar la contraseña y el nombre elegidos en el placeholder. Está limitada
  por IP y por destino; no genera password reset, enlace OOB ni envío de correo.
- `registerWithInvitation` activa la identidad, inicia una sesión nueva y llama a
  `consumeInvitation({ code })`. El código compartido funciona como factor de posesión operativo;
  por eso debe entregarse por un canal controlado y expira, aunque el flujo no dependa de un
  proveedor de correo.
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

## Orden aplicado en el corte y obligatorio para cambios futuros

Las Rules nuevas niegan si token y documento no coinciden; Functions exige además Auth y sesión
vigentes. Por eso los grants se crean y verifican antes de publicar Rules que los exigen. Este orden
se aplicó el 2026-08-31 y se conserva para cambios futuros:

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

Resultado productivo agregado: 5 usuarios totales, 2 activos con claim/grant exactos, 3 QA
deshabilitados con tombstones inactivos y 0 diferencias Auth↔Firestore. No se registran en este
documento correos de usuarios reales, UIDs ni valores de grants. La operación no migró proyectos,
jobs ni archivos.

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
   la mutacion en `jobsitejedi`. Abre una ventana exclusiva: se ejecuta una sola operación de rol a
   la vez y se congelan cambios paralelos desde Firebase Console, otros hosts o automatizaciones.
2. Para asignar siempre se exigen correo, UID, único proveedor exacto, email verificado, cuenta
   habilitada, ausencia de `invitationEnrollmentId` y conteo total esperado. No existe el modo “único
   usuario activo”. La revocación se ancla a correo+UID y no depende de `providerData`, porque vincular
   o retirar un proveedor nunca debe permitir bloquear una retirada de privilegios.
3. Se vuelve a leer el usuario inmediatamente antes del cambio. La copia previa de claims/grant solo
   se conserva en un vault cifrado o expediente con ACL mínima, identificador auditable y retención
   definida; nunca en el repositorio, un archivo temporal en claro o logs. Se elimina al cerrar la
   ventana de rollback conforme a la política operativa.
4. `expectedCurrentRole` es obligatorio incluso si coincide con el rol solicitado; `none` representa
   ausencia de rol. Un `apply` exige un desafío aleatorio de un solo uso, ligado dentro del proceso al
   manifiesto normalizado, al conjunto completo de custom claims y al documento grant auditado; no
   existe una confirmación determinista que pueda reutilizarse entre ejecuciones.
5. La operación escribe primero un grant nuevo para invalidar tokens anteriores, mediante una
   transacción que exige que el documento siga idéntico al auditado. Así no pisa un grant o tombstone
   concurrente. Luego preserva claims no relacionados, asigna `role` + `authorizationGrantId` y
   relee Auth y Firestore exactamente.
6. Si la verificación falla, restaura el estado previo y lo relee. Si no puede probar la compensación,
   exige y verifica un tombstone `active:false`; si tampoco puede, declara estado indeterminado y
   bloquea el despliegue.
7. La persona inicia una sesión nueva. `verify-single-firebase-login.mjs` comprueba token, Auth, grant
   server-side, ruta UI y una lectura Firestore protegida únicamente para el proveedor `password`;
   validar solo el dashboard no basta. Una identidad `google.com` exige Google Sign-In interactivo y
   verificación manual del recorrido equivalente en el navegador autorizado.

Los scripts rechazan cualquier argumento de línea de comandos. Reciben por `stdin` un único
manifiesto JSON de máximo 16 KiB, con campos exactos y sin propiedades adicionales. Plantilla de
asignación dry-run:

```json
{
  "schemaVersion": 1,
  "project": "jobsitejedi",
  "email": "<exacto>",
  "uid": "<exacto>",
  "provider": "<exacto>",
  "expectedUsers": 1,
  "expectedCurrentRole": "<none|admin|manager|builder>",
  "role": "<admin|manager|builder>",
  "apply": false
}
```

`expectedUsers: 1` es un marcador y se reemplaza por el conteo positivo auditado; los demás
marcadores también muestran el contrato y no son valores reales. En
PowerShell 7, el operador puede pegar el JSON de una línea sin historial ni argumentos de proceso:

```powershell
$roleOperationInput = Read-Host -MaskInput "Pegue el manifiesto JSON"
$roleOperationInput | npm.cmd run firebase:role:assign
Remove-Variable roleOperationInput
```

El dry-run no devuelve hashes ni material de confirmación reutilizable. Para aplicar se repite el
mismo manifiesto con `apply: true`. Después de validar el manifiesto y auditar el estado, el proceso
calcula una huella canónica del conjunto completo de custom claims y, para el grant, de su presencia
o ausencia y del documento completo con todas sus claves y valores. La identidad, proveedor y
cardinalidad esperada quedan ligados por separado en el manifiesto normalizado y se vuelven a
comprobar. La herramienta genera entonces un desafío criptográficamente aleatorio de un solo uso,
lo muestra y lee mediante la consola controladora del sistema operativo, separada de `stdin`. El
desafío queda ligado en memoria al manifiesto y a esa huella, y se consume al comprobarlo.

Tras la respuesta del operador y antes de la primera escritura, la herramienta repite el inventario,
revalida identidad/proveedor y relee Auth/Firestore; exige que custom claims, existencia y contenido
del grant sigan siendo idénticos. En asignación también vuelve a exigir cuenta habilitada y correo
verificado. La primera escritura y una eventual restauración del grant usan CAS transaccional; si el
documento cambió, no lo sobrescriben. Una respuesta incorrecta, una relectura diferente, la ausencia
de consola controladora o
una ejecución CI/no TTY abortan antes de mutar; no hay fallback por argumento, variable de entorno,
pipe ni hash persistente. Un nuevo intento requiere una nueva ejecución y un desafío distinto. El
manifiesto se obtiene de un canal protegido, no se guarda en disco y se limpia del
portapapeles/variable al terminar.

Firebase Auth no ofrece una transacción conjunta con Firestore. Por eso el CAS protege el grant —la
autoridad efectiva de Rules/callables— y cualquier diferencia posterior falla cerrada, pero no
sustituye la ventana exclusiva: si no puede garantizarse la serialización administrativa, no se
ejecuta `apply`.

`firebase:role:verify-login` también rechaza `argv`: recibe por `stdin` los mismos campos de
identidad, `expectedUsers` y `role`, pero omite `expectedCurrentRole` y `apply`. Este verificador solo
acepta el proveedor `password`; la contraseña para el smoke se entrega mediante
`FIREBASE_QA_PASSWORD` en memoria. Para `google.com` se usa el login oficial interactivo en un
navegador y dominio autorizados, seguido de comprobación manual de sesión nueva, rol/grant, ruta y
lectura Firestore protegida; el verificador de contraseña no constituye evidencia para Google.

Fuera del prompt efímero del desafío en la consola controladora, los tres scripts emiten solo
agregados, booleanos, rol/ruta esperados y razones de error enumeradas. Los resultados estructurados
nunca incluyen correo, UID, proveedor, manifiesto, desafío ni mensajes arbitrarios del SDK.

## Revocación monotónica

`npm run firebase:role:revoke` usa el mismo contrato por `stdin`, omite `role` y `provider`, y exige
un `expectedCurrentRole` activo. Su `apply` genera un desafío nuevo ligado a la acción `revoke`, al
manifiesto y a la huella Auth/grant revalidada; el dry-run no produce una confirmación reutilizable.
Primero escribe y relee `authorizationGrants/{uid}` con `active:false`; después retira `role`,
`authorizationGrantId` e `invitationEnrollmentId`, y revoca refresh tokens. Nunca borra el documento
ni restaura un grant activo como compensación. Un error que no permita confirmar el tombstone deja el
estado “indeterminado”, bloquea producción y exige inspección manual antes de continuar.

## Rollback

Una asignación fallida puede restaurar claims y grant anteriores únicamente si ambos se verifican;
la restauración del grant exige que todavía pertenezca a esa operación mediante CAS.
Una revocación iniciada no se revierte automáticamente: se conserva el tombstone y cualquier
restauración de privilegio se trata como una nueva asignación con nueva autorización y grant rotado.

No eliminar ni deshabilitar usuarios como parte de este rollback. Cualquier despliegue de codigo,
cambio masivo o limpieza de identidades necesita un procedimiento y una autorizacion separados.
