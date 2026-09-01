# Stack y arquitectura — BuildTrack Pro

Estado: `aceptado por el operador en checkpoint A2.1`

Fecha: `2026-08-31`

## Producto

BuildTrack Pro es una aplicación de gestión de proyectos de construcción para los roles
`admin`, `manager` y `builder`. El flujo crítico es:

`autenticación → dashboard por rol → proyectos/trabajos → tiempo/materiales → archivos y reportes`

## Clasificación provisional

**Nivel 3.** La aplicación combina autenticación, autorización por roles,
datos multiusuario, archivos privados, tiempo real, facturas, procesamiento serverless,
reglas de seguridad y más de un proveedor activo. Esta clasificación exige pruebas de
contrato, reglas, integración y E2E antes de una release.

La clasificación fue confirmada por el operador el `2026-08-24`.

## Stack objetivo propuesto

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Activo |
| UI | Tailwind CSS + shadcn/Radix + Recharts | Activo |
| Routing | React Router DOM | Activo |
| Validación | Zod + React Hook Form | Activo |
| Estado/cache | TanStack Query, hooks locales | Parcial |
| Auth | Firebase Authentication | Activo |
| Datos | Cloud Firestore | Activo |
| Archivos | Firebase Storage privado | Activo |
| Backend privilegiado | Firebase Cloud Functions | Implementado y validado en emuladores |
| Testing | Vitest + Playwright | Activo en CI |
| Infraestructura local | Firebase Emulator Suite | Estabilizada |
| Proveedor legado | Supabase | Solo historial, fuera del runtime |

## Decisión de proveedor

Firebase queda adoptado como proveedor único de runtime para evitar la sesión dividida entre
Firebase Auth y Supabase Database/Storage. La decisión está registrada en el ADR
`docs/adr/ADR-001-proveedor-de-datos.md`.

No se agregará una nueva funcionalidad que dependa de ambos proveedores. Durante la
migración podrán coexistir artefactos históricos, pero no una nueva ruta híbrida de negocio.

## Arquitectura objetivo

- `src/lib/firebase/auth.ts`: sesión, activación segura por invitación, login, logout y claims de rol.
- `src/lib/firebase/repositories/`: acceso tipado a Firestore por dominio.
- `src/lib/firebase/storage.ts`: upload, descarga, thumbnails y URLs temporales.
- `functions/src/`: invitaciones, claims, procesamiento privilegiado y tareas programadas.
- `firestore.rules` y `storage.rules`: autorización real, independiente de React.
- Las pantallas consumen hooks/repositorios; no construyen consultas Firestore directamente.
- Firestore conserva rutas de archivos, no URLs públicas persistentes.

## Seguridad y secretos

- El cliente solo usa variables `VITE_FIREBASE_*` públicas del SDK.
- No se permiten service accounts, claves privadas ni secretos de Functions en el frontend.
- `.env` debe permanecer fuera de Git; las credenciales históricas versionadas deben rotarse.
- Toda regla de acceso se prueba para anónimo, propietario, usuario ajeno y manager.
- Las funciones validan rol e input; el frontend no es frontera de seguridad.
- App Check usa reCAPTCHA Enterprise en el cliente. El despliegue gradual y rollback están en
  `docs/app-check-rollout.md`; `ENFORCE_APP_CHECK=false` permanece durante observación y solo cambia
  con autorización separada.

## Contrato de autorización por roles (T-032)

- `admin` hereda las operaciones de `manager`, puede emitir invitaciones para `manager` o `builder`
  y no puede crear otro admin por autoservicio; esa operación usa el runbook administrativo.
- `manager` puede emitir invitaciones únicamente para `builder`; no puede asignar, promover ni
  degradar roles privilegiados.
- `builder` solo opera sobre proyectos, trabajos y archivos que conserven su asignación canónica.
- Los custom claims de Firebase son la fuente del rol. Firestore/Storage Rules comparan token con
  `authorizationGrants/{uid}`; los callables comparan además el UserRecord y la sesión vigentes. Un
  documento `users/{uid}` nunca cambia el rol y el frontend no es autoridad.
- La revocación escribe primero un tombstone server-only `active:false`; no espera la expiración del
  ID token ni borra el tombstone. Deshabilitar o editar Auth desde Console no reemplaza este paso.
- El dashboard de `admin` reutiliza la superficie operativa de manager y expone explícitamente su
  rol; las reglas Firestore/Storage y las Functions aplican la herencia en servidor.
- La decisión y sus alternativas están registradas en
  `docs/adr/ADR-004-jerarquia-admin-manager-builder.md`.

## Contrato de activación por invitación (T-033)

- Functions precrea un placeholder Auth con contraseña aleatoria no observable y marcador
  `invitationEnrollmentId`; el navegador nunca crea identidades Firebase.
- La invitación v4 liga UID, email hasheado, enrolamiento, generación y lock por destino. Una clave
  cliente de 256 bits permite recuperar la misma respuesta sin guardar el código en claro.
- Firebase password reset fija la contraseña mediante correo con `continueUrl=/auth` sin datos de la
  invitación. Después se exige login nuevo y email verificado antes de asignar el rol.
- El consumo crea el grant server-only en la misma transacción que completa la invitación; usa
  `create` para no reactivar un grant previo y un retry completado solo verifica, nunca restaura.
- Cuentas preexistentes sin marcador no se adoptan, v1-v3 fallan cerrado y el marcador jamás concede
  acceso por sí solo. El contrato y rollback están en `docs/auth-role-operations.md`.

## Contrato de activación directa sin correo (T-036)

- La invitación sigue siendo emitida por una Function protegida y compartida como QR/código de un
  solo uso; el navegador nunca crea identidades ni asigna roles.
- El alta directa valida en servidor el código, el correo exacto y el enrolamiento placeholder,
  aplica rate limit y fija la contraseña elegida en esa identidad. El código es el factor de
  posesión que reemplaza el enlace de correo para este flujo operativo.
- La cuenta se marca como email verificado exclusivamente al activar una invitación v4 pendiente;
  esto no se usa para cuentas normales ni concede rol por sí solo. Después del login, el consumo
  único crea el grant server-only y elimina el marcador como en T-033.
- El cliente solo recibe una respuesta de activación sin contraseña, código, token o claims; el
  password reset y el envío de correos no forman parte de este recorrido.
- Invitaciones antiguas v1-v3 siguen fallando cerrado. El rollback seguro es dejar de exponer el
  callable de activación directa y conservar el contrato v4 vigente; no se borran usuarios ni
  documentos.

## Contrato de autenticación Google (T-020)

- Firebase Authentication conserva un solo contrato de sesión para email/contraseña y Google.
- Google prueba identidad, pero no concede autorización: después del popup se exige un custom claim
  `admin`, `manager` o `builder`; si falta, el cliente cierra la sesión y muestra una explicación segura.
- Las cuentas Google deben ser provisionadas por el flujo operativo autorizado antes de acceder.
  Crear una identidad en Firebase no crea perfiles, proyectos ni permisos de negocio.
- El proveedor `Google` y cada dominio de despliegue se habilitan en Firebase Console por el operador;
  este cambio externo no se ejecuta desde el frontend ni forma parte de un despliegue automático.
- Se usa popup con selector explícito de cuenta. Cancelación, popup bloqueado, dominio no autorizado,
  proveedor deshabilitado y conflicto de método de acceso se normalizan sin filtrar errores internos.

## Contrato de despliegue Vercel (T-021)

- El build exige las seis variables publicas `VITE_FIREBASE_*` de la aplicacion Web SDK y la site
  key pública `VITE_FIREBASE_APPCHECK_SITE_KEY` de
  `jobsitejedi`; rechaza valores vacios, placeholders, otro project ID y modo emulador.
- La validacion nunca imprime valores. Vercel conserva la configuracion remota y Git solo versiona
  nombres, reglas de formato y el procedimiento operativo.
- `vercel.json` reescribe rutas de React Router a `/index.html`, de modo que `/auth`, `/dashboard` y
  los dashboards por rol admiten carga directa y refresh.
- Google Sign-In requiere ademas que `jobsitejedi.vercel.app` este autorizado en Firebase Auth; las
  variables correctas no sustituyen ese control OAuth.
- El contrato completo, verificacion y rollback estan en `docs/vercel-deployment.md`.

## Criterio visual para autenticación Google (T-020)

- **Paleta:** la acción principal de email mantiene `primary`; Google usa un botón `outline` neutro y
  su marca multicolor solo dentro del icono, sin introducir una paleta paralela.
- **Tipografía:** texto y jerarquía existentes en la tarjeta de acceso; el proveedor alternativo no
  compite con el título del producto.
- **Layout:** Google aparece primero como alternativa de acceso y un separador textual conduce al
  formulario email/contraseña; ambos ocupan el ancho completo y funcionan en móvil.
- **Elemento firma:** la tarjeta conserva el casco de BuildTrack Pro y presenta los dos proveedores
  dentro de una sola superficie, dejando claro que conducen al mismo workspace por rol.
- **Piso de calidad:** botón con nombre accesible, foco visible, estado de carga independiente,
  bloqueo de doble envío y error visible cuando la identidad aún no tiene acceso asignado.

## Testing y calidad

Comandos objetivo:

```text
npm.cmd run build
node_modules/.bin/tsc.cmd -p tsconfig.app.json --noEmit
npm.cmd run lint
npm.cmd run test:storage
npm.cmd run test:firebase
npm.cmd run test:provider-guard
npm.cmd run test:e2e:firebase
npm.cmd --prefix functions run build
```

La suite Firebase debe ejecutarse contra emuladores. La suite E2E debe cubrir como mínimo
login, roles, proyectos, trabajos, fotos, inventario, facturas y reportes.

El runtime reproducible de QA es Node 22.23.2 + JDK 21, con descubrimiento de Functions limitado
a 30 segundos. Los comandos con emuladores pasan por `scripts/firebase-emulator-runner.mjs`, que
valida esas versiones antes de iniciar. Node 20 no se adopta porque termino su soporte en marzo de
2026; la instalacion y operacion quedan documentadas en `docs/runtime-qa.md`.

## Criterio visual para la vertical de fotos (T-008)

Como no existe `BRIEF.md`, esta vertical conserva la identidad activa de BuildTrack Pro y
la aterriza al trabajo de obra:

- **Paleta:** tokens semánticos existentes (`primary` para acción de captura, `secondary`
  para contexto, `destructive` para eliminación, `muted` para metadatos y `background`
  para superficie); evita introducir una paleta decorativa que no aparece en el producto.
- **Tipografía:** la tipografía actual del sistema; títulos compactos para identificar el
  trabajo y texto pequeño solo para nombre, tipo y estado del archivo.
- **Layout:** tarjeta de trabajo primero, galería de evidencia después; la carga funciona
  en una columna en móvil y en una rejilla corta en pantallas anchas.
- **Elemento firma:** cada trabajo muestra una tira de evidencia visual con thumbnail y
  estado de privacidad, de modo que el builder ve el avance del trabajo sin abrir una ruta
  técnica ni una URL pública.
- **Piso de calidad:** foco visible, `aria-label` en acciones de archivo, feedback de carga
  y error, y respeto de `prefers-reduced-motion` mediante transiciones no esenciales.

## Criterio visual para la vertical de facturas (T-011)

Como no existe `BRIEF.md`, esta vertical extiende la identidad activa de BuildTrack Pro sin
introducir un sistema visual paralelo:

- **Paleta:** tokens semánticos existentes; `primary` identifica el importe y las acciones,
  ámbar comunica revisión pendiente, esmeralda aprobación y `destructive` rechazo o error.
- **Tipografía:** tipografía actual del producto; importes con cifras tabulares para facilitar
  la comparación y texto secundario compacto para proveedor, fecha y número de factura.
- **Layout:** una bandeja de comprobantes vinculada al proyecto: formulario breve para builder
  y lista de revisión para manager, ambos en una sola columna móvil y con metadatos agrupados.
- **Elemento firma:** cada comprobante se presenta como una tira de recibo con importe, estado y
  acceso al archivo privado, de modo que la decisión financiera se entienda de un vistazo.
- **Piso de calidad:** foco visible, labels explícitos, errores junto al flujo, botones con verbos
  consistentes y sin animación obligatoria; los archivos aceptados se explican antes de cargarlos.

## Criterio visual para la importación de trabajos (T-009)

La carga de trabajos extiende la identidad activa de BuildTrack Pro y se mantiene como una acción
de manager dentro del dashboard:

- **Paleta:** `primary` señala la acción de importar, `muted` describe formatos y límites,
  `destructive` comunica validaciones fallidas y `background` mantiene el flujo legible.
- **Tipografía:** tipografía actual del producto; nombre de archivo y cantidad importada usan una
  jerarquía breve para que la persona confirme el resultado sin leer detalles técnicos.
- **Layout:** diálogo de dos decisiones en orden — proyecto y archivo — con controles apilados en
  móvil y botones de cierre/importación siempre visibles al final.
- **Elemento firma:** la zona de carga punteada funciona como una bandeja de entrada privada y
  explica formatos, tamaño máximo y columnas requeridas antes de enviar.
- **Piso de calidad:** labels explícitos, foco visible, bloqueo de doble envío, estado de error junto
  al control que falló y sin previsualizar ni exponer el contenido del archivo.

## Criterio visual para reportes y riesgo (T-011)

Como no existe `BRIEF.md`, esta vertical reutiliza la identidad activa de BuildTrack Pro para
mantener el contexto de obra visible sin convertir los documentos privados en una superficie
técnica:

- **Paleta:** `primary` para registrar actividad y firmar, `muted` para fechas/metadatos,
  `secondary` para documentos y `destructive` solo para errores; no se introduce una paleta
  paralela.
- **Tipografía:** tipografía actual del producto; descripción legible en primer plano y fecha,
  nombre de archivo y estado como metadatos compactos.
- **Layout:** una bandeja de actividad por proyecto: el builder registra el parte del día y
  revisa documentos pendientes; el manager alterna proyecto para inspeccionar reportes y cargar
  evaluaciones en el mismo flujo.
- **Elemento firma:** cada evaluación muestra una línea de firma por persona y el estado
  `Signed` se conserva junto al documento, para que el cierre de riesgo sea verificable de un
  vistazo.
- **Piso de calidad:** controles etiquetados, estados vacíos/carga/error explícitos, bloqueo de
  doble envío, foco visible y acciones privadas de documento sin URLs públicas.

## Criterio visual para detalle de proyecto y estados (T-012)

El cierre del runtime Supabase conserva la identidad activa y convierte dos pantallas heredadas
en superficies de trabajo coherentes con las verticales Firebase:

- **Paleta:** tokens semánticos existentes; `primary` para navegación y totales, ámbar para revisión,
  esmeralda para cierre y `destructive` únicamente para corrección o error.
- **Tipografía:** tipografía actual; cifras tabulares en horas e importes y jerarquía compacta para
  títulos de trabajo, secciones y metadatos de obra.
- **Layout:** detalle de proyecto agrupado por secciones y libro de estados en una tabla adaptable;
  en móvil los controles se apilan y los registros conservan lectura horizontal.
- **Elemento firma:** una franja de “site ledger” resume horas, facturas, movimientos y trabajos
  cerrados antes del detalle, conectando decisiones financieras con actividad de obra.
- **Piso de calidad:** estados vacíos y de error explícitos, navegación por teclado, labels accesibles,
  acciones con verbos consistentes y transiciones no esenciales respetando movimiento reducido.

## Migración

Se usará migración incremental por verticales:

1. Auth y roles.
2. Reglas y contratos Firestore.
3. Proyectos, trabajos y tiempo.
4. Storage y fotos.
5. Inventario, solicitudes, facturas y reportes.
6. Retirada de referencias runtime a Supabase.

No se importan datos históricos desde Supabase sin un plan separado de datos, backup,
validación y rollback. No se aplican migraciones destructivas en producción desde este
backlog.

## Despliegue y operación

- Desarrollo: Firebase Emulator Suite.
- Validación: staging aislado.
- Producción: solo con backup cuando aplique, rollback documentado y confirmación explícita.
- Antes de usar Functions con APIs externas se debe definir límite de costo, timeout,
  reintentos y alerta presupuestaria.

### Staging aislado y costo

- Target planificado: `jobsitejedi-staging`; nunca se reutiliza `jobsitejedi` para validar.
- Firestore debe usar `eur3`, igual que produccion, y el frontend debe usar una aplicacion Web
  separada.
- Storage y Functions usan `europe-west1` para mantener el backend cerca de Firestore `eur3`; la
  decision y sus alternativas estan registradas en `docs/adr/ADR-003-region-europea-firebase.md`.
- Cloud Storage y Cloud Functions requieren Blaze. Para pruebas manuales de bajo volumen se estima
  USD 0 a 5 por mes, sujeto al consumo real y sin limite duro automatico.
- Staging usa Blaze con un presupuesto mensual de USD 5 y alertas al 50 %, 90 % y 100 %. Las
  alertas no constituyen un limite duro; el operador debe detener staging ante consumo inesperado.
- Contrato, gate, smoke y rollback: `docs/staging-operations.md`.

## Costo de OCR

- **Tesseract.js 7.0.0:** biblioteca Apache-2.0 ejecutada en el navegador; costo de uso: `0` y sin
  credenciales. Los recursos de idioma/core se sirven desde CDN publico y se cachean localmente.
- **Alerta de facturacion:** no aplica a Tesseract.js. Firebase conserva sus controles de costo
  independientes y no se modifican en este slice.
- **Degradacion:** si el CDN o el worker fallan, el builder conserva la captura manual; no hay
  reintentos infinitos ni llamadas pagas.

## Costo de escaneo antimalware de facturas (T-026)

- Diseño recomendado: ClamAV en Cloud Run + Eventarc + Storage siguiendo la arquitectura oficial de
  Google Cloud; aún no desplegado.
- Estimación inicial de bajo volumen: `USD 0–10/mes`, con alerta propuesta al 50 %, 90 % y 100 % de
  `USD 10`. Las alertas no son límite duro.
- La validación local de contenido usa `sharp`/`pdf-lib` sin tarifa por archivo. Integrar o desplegar
  el escáner y sus recursos facturables requiere aprobación independiente.
- Estrategia, degradación, lifecycle y rollback: `docs/invoice-malware-strategy.md`.

## Checkpoint A2.1

Confirmado explícitamente por el operador:

- [x] Firebase como proveedor único objetivo.
- [x] Clasificación Nivel 3.
- [x] Migración incremental sin nueva ruta híbrida.
- [x] Testing con Emulator Suite + Vitest + Playwright.
