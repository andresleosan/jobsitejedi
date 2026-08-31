# Checkpoint de revision - 2026-08-28

Estado: aprobado por el operador el 2026-08-29.
Alcance: cierre tecnico de las 11 tareas en revision.
Este checkpoint no autoriza staging, produccion, migraciones ni gasto.

## Evidencia ejecutada

| Control | Resultado |
| --- | --- |
| Contrato de CI | 3/3 |
| TypeScript | Aprobado |
| ESLint | 0 errores; 7 advertencias conocidas de Fast Refresh |
| Guardia de proveedor | 3/3 |
| Build de Functions | Aprobado |
| Parser de Functions | 3/3 |
| Build web de desarrollo | Aprobado |
| Suite Firebase con emuladores | 67/67 tras fijar la región europea |
| E2E web completo | 8/8 |
| Auditoria de dependencias de runtime | 0 vulnerabilidades |
| Web Vitals de laboratorio | Desktop y mobile dentro del presupuesto |

La ejecucion remota `CI #2` de GitHub Actions tambien finalizo correctamente en el commit
`e907ca668747a014bdfedc127783b9f7d9f77dd3`: los jobs `Quality and contracts` y
`Firebase emulators and E2E` pasaron con todos sus pasos.

## Correccion surgida durante el gate

El E2E detecto un warning de React por una clave duplicada en `ReportsRiskPanel`. La causa era una
carrera entre la recarga remota y la insercion local de un reporte o evaluacion recien creado. La
actualizacion de estado ahora reemplaza por identificador antes de insertar y el E2E falla si el
warning reaparece. Despues de la correccion, la suite completa paso 8/8 sin el warning.

## Estrategia QA Nivel 3

- Contratos: guardia de proveedor, contrato de CI y parser de Functions aprobados.
- Integracion: Auth, Firestore, Functions y Storage se validaron juntos mediante emuladores.
- E2E: ocho recorridos criticos de la interfaz aprobados.
- Concurrencia: se corrigio y cubrio la duplicacion observada en reportes y riesgos.
- Rendimiento: bundle y Web Vitals locales dentro de presupuesto; staging debe repetir la medicion.
- Carga: no se ejecuta una prueba de volumen en local porque requiere datos y capacidad
  representativos; queda como criterio de staging si el perfil esperado lo justifica.

## Revision de seguridad

No se encontraron hallazgos criticos ni vulnerabilidades en dependencias de runtime.

Riesgos residuales que requieren aceptacion o accion antes de produccion:

1. El arbol completo de herramientas de desarrollo reporta 6 vulnerabilidades altas y 7 moderadas,
   sin impacto en el bundle de runtime. Se propone aceptacion temporal, lockfiles y CI obligatorios,
   y nueva revision antes del 2026-09-30.
2. El historial solo expuso nombres de variables del proveedor Supabase retirado; no se encontro una
   clave privada ni una cuenta de servicio. La antigua clave publicable debe revocarse o rotarse como
   higiene antes de produccion.
3. Las callable Functions exigen autenticacion, roles, validacion y limites, pero App Check aun no se
   hace obligatorio. Debe configurarse y probarse primero en staging para no bloquear clientes.

## Repositorio remoto

- La ultima ejecucion de CI observada fue exitosa.
- El ruleset activo `Protect main` exige pull request, bloquea borrado y force-push, y requiere los
  checks `Quality and contracts` y `Firebase emulators and E2E`.

## Recomendacion de cierre

- Lote Firebase vertical: aprobar T-005, T-009, T-010 y T-011.
- Retiro de legado: aprobar T-012 y T-013 por aislamiento; no implica borrado remoto.
- Calidad: aprobar T-014, T-015, T-016 y T-019 con aceptacion temporal del riesgo de tooling.
- CI: aprobar T-022; tratar la proteccion de `main` como configuracion administrativa separada.

## Confirmaciones humanas pendientes

- [x] Aprobar los cuatro lotes anteriores y mover las 11 tareas de `revision` a `aprobada`.
- [x] Confirmar que T-013 cierra por aislamiento sin borrar recursos remotos de Supabase.
- [x] Aceptar temporalmente el riesgo de dependencias de desarrollo hasta la fecha propuesta.
- [x] Exigir ambos jobs de CI en `main` antes de permitir merge.

T-017 continua con la preparacion de un staging aislado. T-018 sigue bloqueada hasta una
confirmacion explicita e independiente para produccion.
