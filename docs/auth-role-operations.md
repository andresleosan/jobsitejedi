# Operacion controlada de roles de Firebase Auth

## Contrato vigente desde T-032 — 2026-08-30

Los roles de aplicación son `admin`, `manager` y `builder`. `admin` hereda la operación de manager
y es el único rol que puede invitar admins o managers; manager solo puede invitar builders. Este
cambio no modifica retrospectivamente la evidencia de 2026-08-28 que aparece abajo.

El operador solicitó que `admin@admin.com` tenga claim `admin`, pero esa solicitud se implementa y
verifica primero en Auth Emulator. Cambiar la cuenta remota requiere un manifiesto con proyecto,
UID/correo verificado, claim anterior, claim propuesto, revocación de refresh tokens y rollback,
seguido de una autorización de producción independiente.

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

## Aplicacion controlada - 2026-08-28

El operador autorizo asignar `manager` al unico usuario activo de `jobsitejedi`.

- Dry-run: 1 usuario activo y rol anterior `null`.
- Cambio: se preservaron los demas custom claims y se asigno solo `role: manager`.
- Verificacion Admin: Firebase devolvio `role: manager` inmediatamente despues de escribir.
- Login real: email/contrasena aceptados y el ID token firmado fue verificado contra Firebase.
- Smoke UI real: la aplicacion termino en `/managers` y no mostro el estado de rol faltante.
- Credenciales: entrada segura en memoria; no se guardaron en argumentos, archivos, capturas o logs.
- Despliegues: ninguno.

## Asignaciones Google dirigidas - 2026-08-28

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
2. Se vuelve a leer el usuario inmediatamente antes del cambio y se conserva fuera del repositorio
   una copia de todos sus custom claims actuales para rollback.
3. Cuando ya existen varios usuarios, se exige correo exacto, proveedor esperado y conteo total
   esperado; cualquier diferencia bloquea la operacion.
4. La operacion server-side preserva los claims no relacionados y cambia solo `role`.
5. Se vuelve a leer el usuario y se verifica que el claim efectivo sea exactamente el autorizado.
6. La persona cierra sesion y vuelve a ingresar para obtener un ID token nuevo.
7. Se ejecuta smoke test del dashboard y de una accion permitida; tambien se confirma que el otro
   dashboard continua denegado.

Si el claim anterior difiere del solicitado, el script exige además
`--expected-current-role=<valor-auditado>` (`none` representa ausencia de rol). Una aplicación
correcta revoca los refresh tokens inmediatamente después de verificar el nuevo claim.

## Rollback

Restaurar el mapa completo de custom claims capturado en el paso 2, volver a leer el usuario y
forzar una nueva sesion. Para el estado auditado actual, el rollback elimina solo `role` y conserva
cualquier otro claim que pudiera existir al momento de la operacion.

No eliminar ni deshabilitar usuarios como parte de este rollback. Cualquier despliegue de codigo,
cambio masivo o limpieza de identidades necesita un procedimiento y una autorizacion separados.
