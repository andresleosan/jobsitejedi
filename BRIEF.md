# Brief de producto — BuildTrack Pro

Estado: `reconciliado con STACK.md y tasks.md`

Fecha: `2026-08-30`

## Problema

Admins, managers y builders necesitan completar el trabajo de una obra en un solo sistema confiable. El
riesgo principal no es la falta de nuevas pantallas, sino que autenticación, proyectos, trabajos,
tiempo, materiales, archivos, facturas y reportes funcionen con el mismo contrato de permisos y
puedan liberarse sin regresiones.

## Usuarios

- `admin`: gobierna cuentas y roles privilegiados; hereda todas las capacidades operativas de
  `manager` para poder auditar y recuperar la operación.
- `manager`: administra proyectos, trabajos, inventario, facturas, documentos e invitaciones
  exclusivamente para `builder`.
- `builder`: ejecuta trabajos, registra tiempo y materiales, aporta evidencia y consulta su obra.

Principio de mínimo privilegio: solo un `admin` puede invitar nuevos `admin` o `manager`; no existe
autoasignación de roles desde el cliente y un `manager` nunca puede elevar privilegios.

## Flujo crítico

`autenticación → dashboard por rol → proyecto/trabajo → tiempo/materiales → archivos/reportes`

## Objetivo de la versión actual

Convertir la migración Firebase ya implementada en una release reproducible y operable. Antes de
agregar funcionalidades nuevas deben existir un gate automatizado, staging, rollback y evidencia
de los flujos críticos contra emuladores y producción autorizada.

## Métricas de aceptación de release

- 100 % de los checks obligatorios de CI aprobados antes de integrar a `main`.
- 0 accesos cruzados permitidos en las pruebas de reglas y roles.
- 100 % de los E2E críticos aprobados sin depender de servicios remotos ni APIs pagas.
- Login y cierre de sesión productivos verificados para las identidades provisionadas.
- 0 vulnerabilidades altas o críticas en dependencias runtime.

## Backlog priorizado — RICE simplificado

| Orden | Resultado | Alcance | Impacto | Confianza | Esfuerzo | Puntaje |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Cerrar la jerarquía `admin → manager → builder` sin escalamiento | 5 | 5 | 5 | 4 | 4,75 |
| 2 | Reconciliar criterios y estados del backlog | 5 | 4 | 5 | 5 | 4,75 |
| 3 | Gate de CI con Node 22, JDK 21, emuladores y E2E | 5 | 5 | 5 | 4 | 4,75 |
| 4 | Staging, observabilidad, costos y rollback | 5 | 5 | 4 | 2 | 4,00 |
| 5 | Validar el inventario remoto de Cloud Functions y sus smoke tests | 4 | 5 | 4 | 3 | 4,00 |
| 6 | Mejoras de UX, accesibilidad y Web Vitals sobre flujos estables | 4 | 3 | 4 | 2 | 3,25 |

## Fuera de alcance por ahora

- Aplicación móvil nativa: primero debe estabilizarse la versión web.
- Roles adicionales a `admin`, `manager` y `builder`: ampliarían la matriz antes de estabilizarla.
- Rediseño visual completo: no mueve la confiabilidad del flujo crítico actual.
- OCR o IA de pago: el fallback manual y Tesseract local cubren la versión actual sin gasto nuevo.
- Migraciones o borrados de Supabase: requieren staging, backup, rollback y autorización separados.
