# Despliegue web en Vercel

Estado: producción verificada el 2026-08-31 con la configuración oficial de `jobsitejedi` y App
Check en observación.

## Contrato de configuracion Firebase

Vite incorpora las variables `VITE_*` durante el build. Vercel debe definir, para `Production`
y `Preview`, los valores oficiales de la aplicacion web Firebase `jobsitejedi`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_APPCHECK_SITE_KEY`

El nombre de una variable nunca es un valor valido. Los valores se obtienen desde la configuracion
Web SDK de Firebase Console o con `firebase apps:sdkconfig WEB <app-id> --project jobsitejedi`.
No deben copiarse desde documentacion, ejemplos ni otro proyecto.

`VITE_FIREBASE_USE_EMULATORS` debe estar ausente o ser `false` en cualquier despliegue. El comando
`npm run build` valida formato, proyecto y placeholders antes de invocar Vite, sin imprimir valores.
Un error bloquea el build para evitar publicar una pantalla en blanco.

## Enrutamiento SPA

`vercel.json` reescribe las rutas del navegador a `/index.html`. Los recursos estaticos siguen
sirviendose normalmente y rutas como `/auth`, `/dashboard` y `/managers` pueden cargarse o
refrescarse directamente sin `404 NOT_FOUND`.

## Google Sign-In

Firebase Authentication debe autorizar el hostname exacto `jobsitejedi.vercel.app`. Esta lista es
independiente de las variables de Vercel. No autorizar comodines de previews; cada hostname usado
para OAuth debe revisarse y agregarse de forma explicita.

## Estrategia vigente de staging

T-017 y el frontend Vercel separado fueron supersedidos. `Production` y `Preview` del proyecto
Vercel `jobsitejedi` apuntan a la aplicación Web oficial de Firebase `jobsitejedi`; no se mezclan
variables de `jobsitejedi-staging`.

El proyecto Firebase `jobsitejedi-staging` permanece únicamente como recurso temporal pendiente de
retirada controlada. No recibe usuarios ni datos de prueba y no se elimina desde Vercel. Su posible
borrado no ocurre antes del 2026-09-07 13:55 America/Bogota y requiere inventario y autorización
destructiva separada.

## Procedimiento controlado aplicado y reutilizable

1. Consultar la configuracion Web SDK oficial de Firebase en modo de solo lectura.
2. Reemplazar juntas las siete variables en Vercel para `Production` y `Preview`.
3. Confirmar que `VITE_FIREBASE_USE_EMULATORS` no sea `true`.
4. Mantener `jobsitejedi.vercel.app` en los dominios autorizados de Firebase Authentication y App
   Check; no autorizar comodines de preview.
5. Desplegar el commit que contiene `vercel.json` y el validador, y exigir CI verde sobre su SHA.
6. Verificar carga directa de `/auth` y `/`, redirección anónima de rutas protegidas y consola sin
   errores. Los positivos de `admin`/`manager`/`builder` se ejecutan en Emulator/E2E; no se reactivan
   credenciales QA compartidas de producción para el smoke.

La actualizacion de variables no modifica usuarios, claims, reglas ni datos Firestore.

## Evidencia productiva — 2026-08-31

- Release de aplicación: `864335ecf4e497221469e3462a623c5211e5846e`.
- CI de `main`: [run 33433050837](https://github.com/andresleosan/jobsitejedi/actions/runs/33433050837),
  ambos jobs verdes.
- Deployment `HVMXDbSrwh8XYaXram1b99M7N3Vx`: `Ready`, `Production` y `Current` al verificar la release.
- El build productivo aceptó `VITE_FIREBASE_APPCHECK_SITE_KEY` oficial sin revelar su valor.
- `/auth` mostró el formulario esperado, `/admins` anónimo redirigió a `/auth` y `/` cargó la SPA.

Referencias oficiales:

- https://vercel.com/docs/frameworks/frontend/vite
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/project-configuration/vercel-json
- https://firebase.google.com/docs/auth/web/google-signin

## Rollback

- Restaurar los valores anteriores de Vercel desde el historial de variables y promover el ultimo
  deployment estable que siga cumpliendo el contrato de grants v4.
- Retirar `jobsitejedi.vercel.app` de dominios autorizados solo si el dominio deja de servir la app.
- No eliminar usuarios ni claims como parte del rollback del frontend.
- No restaurar un cliente que dependa de `setUserRole`, `ensureBuilderRole` o invitaciones v1-v3.
