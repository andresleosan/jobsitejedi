# Operacion de staging

Fecha: 2026-08-29

## Estado y limite de autorizacion

La preparacion local esta completa. El proyecto remoto `jobsitejedi-staging` y su aplicacion Web
fueron creados el 2026-08-29. Staging usa Blaze, Firestore `eur3`, Storage privado en
`europe-west1`, autenticacion por email/contrasena y nueve Functions activas. Las reglas e indices
versionados estan desplegados. Este runbook no autoriza produccion.

| Entorno | Firebase project ID | Uso |
| --- | --- | --- |
| Desarrollo y CI | `demo-jobsite-jedi` | Emulator Suite, nunca remoto |
| Staging | `jobsitejedi-staging` | Blaze; presupuesto USD 5; provision parcial |
| Produccion | `jobsitejedi` | Fuera del alcance de T-017 |

El build de staging usa `npm run build:staging` y rechaza el project ID productivo, placeholders,
un dominio Auth ajeno, un bucket ajeno y modo emulador.

## Checkpoint de costo

Cloud Storage for Firebase y el despliegue de Cloud Functions requieren Blaze. Para una validacion
manual de bajo volumen se estima un costo esperado de USD 0 a 5 por mes si permanece dentro de las
cuotas sin costo, pero Blaze es pago por uso y una alerta no actua como limite duro.

Checkpoint confirmado por el operador el 2026-08-29:

- [x] Cuenta de facturacion vinculada exclusivamente por el flujo oficial de Google Cloud.
- [x] Presupuesto mensual de USD 5 limitado al proyecto de staging.
- [x] Alertas al 50 %, 90 % y 100 % del presupuesto.
- [x] El operador revisara las alertas y apagara staging si hay consumo inesperado.

No se guardan credenciales de facturacion, tokens ni valores Firebase en Git.

## Provision inicial

Solo despues del checkpoint de costo:

1. Crear `jobsitejedi-staging` con nombre visible `Jobsite Jedi Staging`.
2. Vincular Blaze y configurar las alertas aprobadas.
3. Crear Firestore Native en `eur3`, la misma ubicacion observada en produccion.
4. Crear el bucket predeterminado en `europe-west1`; ver
   `docs/adr/ADR-003-region-europea-firebase.md`.
5. Registrar una aplicacion Web y obtener sus seis valores publicos Web SDK.
6. Habilitar email/password y Google Auth; autorizar solo el hostname exacto de staging.
7. Configurar App Check para Web, observar metricas primero y exigir tokens solo despues del smoke.
8. Mantener `ENABLE_PROJECT_CLEANUP=false`.

Los valores Web SDK se cargan en el gestor de secretos/variables del proveedor de staging, nunca en
`.env`, logs, issues o commits. `VITE_FIREBASE_USE_EMULATORS` debe estar ausente o en `false`.

## Gate previo a deploy

```bash
npm ci
npm --prefix functions ci
npm run test:ci-contract
npm run test:provider-guard
npm run typecheck
npm run lint
npm run build:functions
npm run test:firebase:emulator
npm run test:e2e:firebase:emulator
npm run build:staging
```

El ultimo comando se ejecuta en el entorno que contiene las variables publicas de staging. El gate
debe conservar 0 vulnerabilidades de runtime y no puede imprimir valores.

## Orden de despliegue

1. Capturar el commit y los artefactos que se van a desplegar.
2. Confirmar que el target resuelto sea `jobsitejedi-staging`; abortar si aparece `jobsitejedi`.
3. Desplegar indices y reglas Firestore/Storage al target `staging`.
4. Desplegar Functions al target `staging`, con cleanup destructivo deshabilitado.
5. Publicar el frontend como Preview/Staging usando las variables del mismo proyecto.
6. Ejecutar smoke de `/auth`, roles, proyecto sintetico, archivo privado, factura, reporte y firma.
7. Revisar logs, App Check y consumo; no copiar datos ni usuarios de produccion.

No se usaran datos reales. Los fixtures sinteticos de staging pueden borrarse y recrearse.

El repositorio de imagenes de Functions conserva siete dias y elimina automaticamente artefactos
anteriores para contener costos. Esta politica no elimina Functions activas ni archivos de usuarios.

El proyecto Vercel productivo conserva variables Firebase de produccion tanto para `Production`
como para `Preview`; no debe reutilizarse sin aislamiento. La ruta recomendada es un proyecto
Vercel Hobby separado, `jobsitejedi-staging`, con `npm run build:staging` y solo las seis variables
Web SDK del proyecto Firebase de staging.

## Backup y rollback

En el primer despliegue no existe informacion que respaldar. En despliegues posteriores:

- Registrar conteos de documentos, usuarios de prueba y objetos antes del cambio.
- Exportar Firestore y verificar que el manifiesto de exportacion exista antes de una migracion.
- Registrar inventario de Storage antes de modificar rutas o reglas.
- Conservar el ultimo commit estable y el deployment web anterior.

Rollback:

1. Detener pruebas y deshabilitar temporalmente el frontend de staging si existe exposicion.
2. Volver a desplegar reglas, indices y Functions desde el ultimo commit estable.
3. Promover el deployment web estable anterior.
4. Restaurar datos solo desde un backup verificado; nunca usar produccion como fuente rapida.
5. Repetir smoke y documentar causa antes de reintentar.

## Gate de salida de T-017

- [x] Contrato local de entornos y build aislado.
- [x] Guia de variables, emuladores, costos, backup, rollback y smoke.
- [x] Proyecto remoto vinculado a Blaze con presupuesto y alertas configurados.
- [x] Firestore `eur3`, Storage privado `europe-west1` y Email/Password provisionados.
- [x] Reglas, indices y 9/9 Functions desplegados; cleanup de artefactos fijado a 7 dias.
- [x] Smoke backend: codigo invalido seguro y callable protegida rechaza sin sesion con HTTP 401.
- [ ] App Check configurado y validado sin bloquear clientes legitimos.
- [ ] Frontend staging publicado; gate y smoke funcional completos ejecutados.
- [ ] Checklist operativo revisado por el operador.

T-017 permanece `en-progreso` hasta completar los tres puntos externos. T-018 no se abre con este
runbook y siempre requiere una confirmacion separada para produccion.
