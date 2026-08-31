# Despliegue web en Vercel

## Contrato de configuracion Firebase

Vite incorpora las variables `VITE_*` durante el build. Vercel debe definir, para `Production`
y `Preview`, los valores oficiales de la aplicacion web Firebase `jobsitejedi`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

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

## Staging aislado

El proyecto Vercel `jobsitejedi` conserva Firebase de produccion en `Production` y `Preview`; no se
cambian esos valores para T-017. Staging se publica en un proyecto Vercel Hobby separado llamado
`jobsitejedi-staging`, con build command `npm run build:staging` y las seis variables de la
aplicacion Web Firebase `jobsitejedi-staging`. Su hostname exacto se autoriza en Firebase Auth y
App Check despues de conocer el deployment real. Ninguna variable se copia al repositorio.

## Procedimiento controlado

1. Consultar la configuracion Web SDK oficial de Firebase en modo de solo lectura.
2. Reemplazar juntas las seis variables en Vercel para `Production` y `Preview`.
3. Confirmar que `VITE_FIREBASE_USE_EMULATORS` no sea `true`.
4. Agregar `jobsitejedi.vercel.app` a los dominios autorizados de Firebase Authentication.
5. Desplegar el commit que contiene `vercel.json` y el validador.
6. Verificar `/auth` con carga directa, email/contrasena, redireccion por claim `manager` y Google.

La actualizacion de variables no modifica usuarios, claims, reglas ni datos Firestore.

Referencias oficiales:

- https://vercel.com/docs/frameworks/frontend/vite
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/project-configuration/vercel-json
- https://firebase.google.com/docs/auth/web/google-signin

## Rollback

- Restaurar los valores anteriores de Vercel desde el historial de variables y promover el ultimo
  deployment estable.
- Retirar `jobsitejedi.vercel.app` de dominios autorizados solo si el dominio deja de servir la app.
- No eliminar usuarios ni claims como parte del rollback del frontend.
