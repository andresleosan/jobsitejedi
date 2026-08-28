# Operacion controlada de roles de Firebase Auth

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

## Precondiciones para asignar un rol

1. El operador confirma la identidad objetivo, el rol exacto (`manager` o `builder`) y autoriza
   la mutacion en `jobsitejedi`.
2. Se vuelve a leer el usuario inmediatamente antes del cambio y se conserva fuera del repositorio
   una copia de todos sus custom claims actuales para rollback.
3. La operacion server-side preserva los claims no relacionados y cambia solo `role`.
4. Se vuelve a leer el usuario y se verifica que el claim efectivo sea exactamente el autorizado.
5. La persona cierra sesion y vuelve a ingresar para obtener un ID token nuevo.
6. Se ejecuta smoke test del dashboard y de una accion permitida; tambien se confirma que el otro
   dashboard continua denegado.

## Rollback

Restaurar el mapa completo de custom claims capturado en el paso 2, volver a leer el usuario y
forzar una nueva sesion. Para el estado auditado actual, el rollback elimina solo `role` y conserva
cualquier otro claim que pudiera existir al momento de la operacion.

No eliminar ni deshabilitar usuarios como parte de este rollback. Cualquier despliegue de codigo,
cambio masivo o limpieza de identidades necesita un procedimiento y una autorizacion separados.
