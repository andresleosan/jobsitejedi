# Runtime reproducible de QA Firebase

## Versiones soportadas

- Node.js `22.23.2` (`.nvmrc` y `.node-version`).
- JDK `21` (`.java-version`).
- Timeout de descubrimiento de Functions: `30000` ms.
- Runtime de Cloud Functions: `nodejs22` en `firebase.json` y Node `22` en
  `functions/package.json`.

Node 20 no se adopta aunque aparecia en la recomendacion inicial: termino su soporte el
24 de marzo de 2026. Node 22 sigue soportado por Firebase Functions y evita fijar un runtime
sin parches de seguridad.

Referencias oficiales:

- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/en/about/eol
- https://firebase.google.com/docs/functions/manage-functions

## Ejecucion

1. Activar Node con `nvm use` o cualquier gestor que respete `.nvmrc`.
2. Instalar/seleccionar JDK 21 y definir `JAVA_HOME` a esa instalacion.
3. Instalar dependencias con `npm ci` y `npm --prefix functions ci`.
4. Ejecutar `npm run test:firebase:emulator` para la suite de integracion.
5. Ejecutar `npm run test:e2e:auth:emulator` para la regresion focalizada de acceso sin rol.

El wrapper `scripts/firebase-emulator-runner.mjs` falla antes de iniciar si Node o Java no
coinciden. Compila Functions, usa el CLI local del proyecto, levanta Auth, Firestore, Functions
y Storage sobre `demo-jobsite-jedi`, y cierra los emuladores al terminar.

Cambiar `firebase.json` no despliega nada por si solo. `nodejs22` se aplicara al entorno remoto
unicamente durante un despliegue de Functions confirmado y ejecutado por separado.
