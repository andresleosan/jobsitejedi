# Operacion de autenticacion Google

## Estado remoto verificado - 2026-08-28

- Google Sign-In esta habilitado y tiene cliente OAuth configurado.
- Dominios autorizados: `localhost`, `jobsitejedi.firebaseapp.com`, `jobsitejedi.web.app` y
  `jobsitejedi.vercel.app`.
- El sitio Firebase Hosting predeterminado es `jobsitejedi`.
- `127.0.0.1` no esta autorizado y no se agregara: QA y desarrollo deben abrir
  `http://localhost:<puerto>` para mantener la lista de origenes al minimo.
- No hay un hostname de staging definido en el repositorio. Cuando exista, debe agregarse por su
  hostname exacto antes de ejecutar la validacion de staging.

La verificacion fue de solo lectura y no mostro ni guardo el secreto del cliente OAuth.

La validacion productiva posterior confirmo el contrato completo: una identidad Google nueva se
autentica, queda bloqueada con el estado explicito de rol faltante, recibe `manager` solo mediante
la operacion server-side autorizada y puede volver a entrar normalmente. Una segunda identidad
Google autorizada repitio creacion, dry-run y asignacion verificada de `manager`.

## Contrato del cliente

El cliente usa `GoogleAuthProvider` + `signInWithPopup` y exige el mismo custom claim
`manager`/`builder` que el acceso con contrasena. El codigo no autoasigna roles.

Antes de validar un nuevo entorno, el operador debe comprobar en Firebase Authentication:

1. Google habilitado en **Security > Authentication > Sign-in method**.
2. `localhost` para desarrollo y los hostnames exactos de staging/produccion. No alternar entre
   `localhost` y `127.0.0.1`: Firebase los considera origenes distintos.
3. La identidad Google provisionada con un claim `manager` o `builder` mediante el flujo
   server-side autorizado. Una identidad sin claim se cierra de inmediato y no entra al dashboard.

Firebase ya no incluye necesariamente `localhost` en proyectos nuevos. Referencias oficiales:

- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/auth/faq-and-troubleshooting

## Validacion local

1. Iniciar la aplicacion y abrir `http://localhost:<puerto>/auth`.
2. Confirmar que el popup permite seleccionar cuenta y no devuelve `auth/unauthorized-domain`.
3. No usar `http://127.0.0.1:<puerto>` para este flujo.

## Validacion de staging

- Abrir el hostname autorizado, no una IP alternativa.
- Confirmar que el popup permite seleccionar cuenta.
- Probar cuenta con rol `manager`, cuenta con rol `builder` y cuenta sin rol.
- Confirmar que cada rol llega solo a su dashboard y que la cuenta sin rol permanece en `/auth`.
- Confirmar cancelacion, popup bloqueado y conflicto con otro metodo de acceso.

No se reintenta automaticamente un popup OAuth: cada reintento requiere una accion explicita de la
persona usuaria.

## Rollback

Deshabilitar Google en Firebase Authentication retira el proveedor sin afectar email/contrasena.
No eliminar usuarios ni claims durante el rollback; cualquier limpieza de identidades requiere un
plan separado y confirmacion del operador.
