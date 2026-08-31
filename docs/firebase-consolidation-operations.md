# Consolidacion Firebase en `jobsitejedi`

Fecha: 2026-08-29

## Objetivo y limite

Consolidar en el proyecto Firebase original `jobsitejedi` el backend ya validado en
`jobsitejedi-staging`. La retirada de staging no forma parte del mismo cambio: solo puede ocurrir
despues de observar produccion durante al menos siete dias, repetir el inventario y obtener una
confirmacion destructiva en el momento del borrado.

## Inventario verificado

| Recurso | `jobsitejedi` | `jobsitejedi-staging` | Accion |
| --- | --- | --- | --- |
| Auth | 3 usuarios; Google y email ya usados | 0 usuarios | Conservar produccion; no importar |
| Firestore | `eur3`; sin colecciones | `eur3`; sin colecciones | Desplegar reglas e indices; no copiar datos |
| Storage | No habilitado; plan gratuito | Bucket `europe-west1`; 0 archivos | Crear bucket productivo y desplegar reglas |
| Functions | No listables/no desplegadas | 9 Functions Node 22 en `europe-west1` | Desplegar las 9 desde Git |
| Aplicacion Web | Activa y usada por Vercel | Activa, sin frontend publicado | Conservar la app Web productiva |

No se exportan usuarios ni hashes de contrasena. No se mueven fixtures, documentos ni archivos
porque staging esta vacio y produccion tampoco contiene documentos o archivos que fusionar.

## Checkpoint de costo completado

Cloud Storage y Cloud Functions requieren Blaze. El operador completo este checkpoint el
2026-08-29:

- [x] Se autorizo y vinculo `jobsitejedi` a la misma cuenta de facturacion de staging.
- [x] Se configuro un presupuesto mensual de COP 16.014, equivalente a USD 5 con la TRM vigente
  de COP 3.202,79 por USD, con alertas al 50 %, 90 % y 100 %. Las alertas no son un limite duro.
- [x] Se creo `jobsitejedi.firebasestorage.app` como bucket regional permanente en
  `europe-west1` (Belgica), clase Regional.

La consola de Google Cloud confirmo que el presupuesto aplica exclusivamente al proyecto
`jobsitejedi` y que los tres umbrales quedaron activos.

## Gate previo

```powershell
npm.cmd audit --omit=dev
npm.cmd run test:ci-contract
npm.cmd run test:provider-guard
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build:functions
npm.cmd run test:firebase:emulator
npm.cmd run test:e2e:firebase:emulator
npm.cmd run build
```

La aceptacion exige 0 vulnerabilidades runtime, 0 errores de lint, suites Firebase/E2E completas y
ausencia de hallazgos criticos. Los avisos conocidos deben quedar documentados y no pueden ocultar
errores.

## Baseline de rendimiento de esta release

El frontend no cambio: el build productivo conserva el baseline ya documentado en
`docs/performance-baseline.md`. La unica ruta modificada fue `validateInvitationCode`.

- Medicion: 30 llamadas consecutivas con Functions y Firestore Emulator, despues del arranque.
- Resultado observado: aproximadamente 33-52 ms por llamada caliente.
- Proteccion: la solicitud 31 dentro de la ventana fue rechazada con `resource-exhausted`.
- Costo de consulta: cada validacion permitida ejecuta una transaccion de limite y, si el formato
  es valido, una busqueda acotada a un documento. No se detecto N+1 ni un cuello de botella que
  justifique optimizacion o `scalability-patterns` antes del deploy.

## Orden de despliegue

1. Registrar commit, inventario productivo y estado de los gates.
2. Completar el checkpoint Blaze y crear el bucket `jobsitejedi.firebasestorage.app` en
   `europe-west1`.
3. Desplegar reglas e indices Firestore y reglas Storage explicitamente a `jobsitejedi`.
4. Desplegar las nueve Functions desde el codigo versionado, todas en `europe-west1`, con
   `ENABLE_PROJECT_CLEANUP` ausente o distinto de `true`.
5. Verificar inventario 9/9 y ejecutar smokes negativos de autenticacion/invitaciones.
6. Ejecutar smoke funcional con cuentas productivas existentes, sin crear datos permanentes salvo
   un fixture identificado y reversible.
7. Revisar logs, errores y consumo. App Check inicia en observacion; su enforcement requiere un
   cambio separado para no bloquear clientes legitimos.

## Ejecucion productiva de 2026-08-29

Revision base registrada: `a7be8a287f10fcf71b933e44df8e524c3d9b5891`. El despliegue incluyo
cambios locales todavia no confirmados en Git; por eso tambien se registraron estas huellas:

| Artefacto | SHA-256 |
| --- | --- |
| `firestore.rules` | `F0C73A8F0B710F69854314FB7828C47A9D00D80A0B6089D20E8DD0FAA5336949` |
| `firestore.indexes.json` | `6742255415C36DAF631B52F233039190AF819205CC41FA58D07DD7D9E180C2B9` |
| `storage.rules` | `EA9538E101538F63C203FEE47497E182495C9BD2E34320FB32D4FDAA2C5B6A7A` |
| `functions/src/index.ts` | `C6C054039E25E2AB61B0DD0059E95E3AB07749C4A9CC6E22A40A6DECA9D39126` |
| `functions/lib/index.js` | `D5030720BD7809F877C3CA96532A06E48BBA632CCC35AF105F6939F81182EAB3` |

Resultado remoto:

- Blaze activo con la cuenta de facturacion autorizada y el presupuesto descrito arriba.
- Bucket vacio confirmado en `europe-west1`; sus reglas productivas compilaron y fueron publicadas.
- Reglas Firestore e indices publicados explicitamente con `--project jobsitejedi`; no habia
  indices compuestos ni datos que importar.
- Nueve de nueve Functions Gen 2 activas, Node 22, todas en `europe-west1`. El primer alta dejo
  4/9 por una carrera al crear el bucket interno de fuentes; un reintento acotado creo las cinco
  restantes y el inventario final confirmo 9/9 `ACTIVE`.
- `cleanupOldProjects` quedo programada cada 24 horas, pero `ENABLE_PROJECT_CLEANUP` estuvo ausente:
  puede limpiar invitaciones y limites expirados, no proyectos de negocio.
- Smoke sin credenciales y sin fixtures: `validateInvitationCode` rechazo un envelope invalido con
  HTTP 400 `INVALID_ARGUMENT`; `ensureBuilderRole` rechazo una solicitud valida sin sesion con
  HTTP 401 `UNAUTHENTICATED`.
- `https://jobsitejedi.vercel.app/auth` cargo la SPA productiva y la consola Firebase confirmo las
  mismas tres cuentas Auth (una fila de cabecera y tres usuarios). No se modificaron usuarios,
  proveedores ni claims.
- Los dos eventos graves encontrados en las primeras 100 lineas de logs corresponden al envelope
  invalido del smoke y a la carrera transitoria del primer alta. La Function afectada fue creada
  correctamente en el reintento; no se observo un error runtime nuevo sin explicar.

Artifact Registry conserva por ahora sus imagenes de compilacion sin politica automatica de
limpieza. Firebase advirtio que esto puede producir un cargo mensual pequeno. La politica propuesta
de un dia no se aplico porque borraria material util para rollback y requiere una autorizacion
destructiva separada. Durante la observacion se debe vigilar este consumo y elegir una retencion
compatible con rollback antes de acumular nuevas releases.

## Rollback

- Frontend/Auth: no se cambian durante este despliegue; conservar la aplicacion Web y proveedores
  actuales.
- Firestore/Storage Rules: volver a desplegar la revision Git anterior. Firebase no ofrece rollback
  automatico de Rules, por lo que el commit previo debe quedar registrado antes del cambio.
- Functions: si el smoke falla, detener trafico desde el frontend y retirar las Functions nuevas o
  volver a desplegar la revision estable. No habilitar borrado automatico de proyectos.
- Datos: no hay importacion. Si aparece cualquier documento/archivo inesperado antes del deploy,
  detener el proceso y redefinir backup antes de continuar.
- Bucket: su region es permanente. Un rollback funcional no elimina el bucket; queda vacio y con
  reglas restrictivas hasta una decision operativa posterior.

## Gate de retirada de staging

La observacion comenzo el 2026-08-29. El primer momento elegible es el 2026-09-05 despues de las
12:02, hora de Colombia, siempre que se cumpla todo lo siguiente:

- [ ] Produccion mantiene 9/9 Functions activas y smoke limpio.
- [ ] No hay errores nuevos ni consumo inesperado.
- [ ] Staging sigue con 0 usuarios, 0 documentos y 0 archivos.
- [ ] Se conserva evidencia de configuracion y del commit desplegado.
- [ ] El operador confirma explicitamente el borrado destructivo.

Solo entonces se elimina `jobsitejedi-staging`, se comprueba que deje de facturar y se retira su
alias de `.firebaserc`. El proyecto original `jobsitejedi` nunca se incluye en el comando de borrado.
