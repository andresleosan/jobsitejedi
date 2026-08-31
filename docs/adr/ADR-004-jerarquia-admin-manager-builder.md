# ADR-004: Jerarquía admin, manager y builder

Fecha: 2026-08-30

Estado: aceptada por decisión explícita del operador

## Contexto

El producto necesita una identidad administrativa real (`admin@admin.com`). El contrato anterior
solo reconocía `manager` y `builder`, y usaba esa cuenta como caso negativo sin rol. Concederle el
claim `manager` ocultaría la responsabilidad de gobierno y permitiría que cualquier manager siguiera
emitiendo invitaciones privilegiadas.

## Decisión

Firebase custom claims reconocerá `admin | manager | builder`. `admin` hereda las capacidades
operativas de `manager`; solo `admin` puede invitar `admin` o `manager`; `manager` solo puede invitar
`builder`; `builder` conserva acceso a recursos asignados. No se crea una API directa para promover
roles y el cliente nunca es autoridad de autorización.

## Alternativas consideradas

- Mantener dos roles y tratar admin como manager: se descartó porque no separa operación de gobierno
  ni permite bloquear elevaciones realizadas por managers.
- Crear permisos granulares independientes de roles: se descartó para esta release por ampliar mucho
  la matriz, migraciones y superficie de prueba sin una necesidad demostrada.
- Guardar el rol solo en Firestore: se descartó porque duplicaría la autoridad respecto de custom
  claims y abriría inconsistencias entre Functions, Rules y cliente.

## Consecuencias

- Se gana separación explícita de funciones, recuperación operativa por admin y mínimo privilegio en
  invitaciones.
- Aumenta la matriz de pruebas y todas las comprobaciones exactas de `manager` deben distinguir entre
  una operación heredable y una operación exclusiva de gobierno.
- Las cuentas remotas existentes requieren auditoría de claims, plan de cambio y revocación de tokens.
  No se cambia ningún claim remoto ni se despliega desde este ADR.

## Rollback

Antes de producción se exportará el inventario de UIDs/claims sin secretos. Para revertir, se restaura
el claim previo de cada UID afectado mediante el procedimiento administrativo autorizado, se revocan
sus refresh tokens y se revierte conjuntamente cliente, Functions y Rules al mismo SHA. Nunca se
revierte solo una capa porque produciría autorización divergente.
