# ADR-004: Jerarquía admin, manager y builder

Fecha: 2026-08-30; enmendada 2026-08-31 tras las revisiones de pre-hijacking y revocación

Estado: aceptada por decisión explícita del operador

## Contexto

El producto necesita una identidad administrativa real (`admin@admin.com`). El contrato anterior
solo reconocía `manager` y `builder`, y usaba esa cuenta como caso negativo sin rol. Concederle el
claim `manager` ocultaría la responsabilidad de gobierno y permitiría que cualquier manager siguiera
emitiendo invitaciones privilegiadas.

La revisión v4 demostró además que el autoservicio de cuentas privilegiadas amplifica el impacto de
un código filtrado y de una activación de email mal ligada. La release no tiene MFA ni aprobación
dual, por lo que crear nuevos admins por invitación no cumple el nivel de control requerido.

## Decisión

Firebase custom claims reconocerá `admin | manager | builder`. `admin` hereda las capacidades
operativas de `manager`, puede invitar `manager` o `builder`, y una invitación manager exige una
autenticación reciente. `manager` solo puede invitar `builder`; `builder` conserva acceso a recursos
asignados. El alta o reemplazo de un `admin` se realiza únicamente por el runbook administrativo con
identidad exacta, auditoría, revocación de sesiones y autorización productiva. No se crea una API
directa para promover roles y el cliente nunca es autoridad de autorización.

La autorización efectiva no depende solo del rol cacheado en un ID token. Cada rol lleva un
`authorizationGrantId` y un registro server-only `authorizationGrants/{uid}`. Firestore/Storage Rules
exigen token↔documento activo; los callables exigen además UserRecord y sesión vigentes. Una rotación
o tombstone invalida inmediatamente tokens anteriores; deshabilitar o editar Auth sin ese documento
no basta para Rules. La revocación escribe el tombstone antes de retirar claims y nunca lo elimina
como rollback automático.

## Alternativas consideradas

- Mantener dos roles y tratar admin como manager: se descartó porque no separa operación de gobierno
  ni permite bloquear elevaciones realizadas por managers.
- Crear permisos granulares independientes de roles: se descartó para esta release por ampliar mucho
  la matriz, migraciones y superficie de prueba sin una necesidad demostrada.
- Permitir que admin invite otro admin: se descartó mientras no existan MFA, autenticación reciente
  reforzada y segunda aprobación; el bootstrap controlado ya cubre recuperación sin exponer esa ruta.
- Guardar el rol solo en Firestore: se descartó porque duplicaría la autoridad respecto de custom
  claims y abriría inconsistencias entre Functions, Rules y cliente.
- Confiar en expiración/revocación de refresh tokens: se descartó porque un ID token ya emitido puede
  seguir autorizando Rules. El grant server-side permite cortar esa sesión sin esperar su expiración.

## Consecuencias

- Se gana separación explícita de funciones, recuperación operativa por admin y mínimo privilegio en
  invitaciones.
- Se sacrifica el alta autoservicio de admins. Esa fricción es intencional y queda concentrada en un
  procedimiento infrecuente, auditable y reversible.
- Aumenta la matriz de pruebas y todas las comprobaciones exactas de `manager` deben distinguir entre
  una operación heredable y una operación exclusiva de gobierno.
- Las cuentas remotas existentes requieren auditoría de claims, plan de cambio y revocación de tokens.
  No se cambia ningún claim remoto ni se despliega desde este ADR. Las tres identidades QA remotas
  permanecen deshabilitadas hasta autorización posterior.
- El despliegue requiere backfill aditivo de grants antes del cutover y una nueva autenticación de
  usuarios. Desplegar Rules/Functions sin esa migración causaría una denegación total y está prohibido.

## Rollback

Antes de producción se exportará el inventario de UIDs/claims/grants sin secretos. Una asignación que
falle puede compensarse al par claims+grant previo solo si ambos se releen exactamente. Una revocación
iniciada es monotónica: restaurar privilegios exige una autorización nueva y un grant nuevo. Nunca se
revierte Functions o Rules al contrato de solo rol, ni una sola capa, porque reautorizaría tokens
obsoletos y produciría autorización divergente. El rollback seguro conserva Rules cerradas y corrige
hacia adelante; la UI sí puede revertirse de forma aislada.
