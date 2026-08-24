# Subagentes y Delegación Controlada (ADR-013)

Cronos puede delegar hasta **3 unidades acotadas** a subagentes temporales en paralelo (`subagent_depth: 1`, sin delegación anidada), pero sigue siendo el agente primario, interlocutor y autoridad final.

## Guardrails Innegociables para Subagentes
1. **Sin Git ni Versionado**: Los subagentes no hacen commits, ramas, pull requests ni releases.
2. **Sin Secretos**: Los subagentes no leen credenciales, variables de entorno protegidas ni archivos `.env`.
3. **Sin Migraciones Destructivas**: Los subagentes no ejecutan DROP TABLE, TRUNCATE, borrados masivos ni modificaciones destructivas de esquemas.
4. **Sin Despliegues**: Los subagentes no despliegan a producción ni a staging.
5. **Sin Gasto**: Los subagentes no provisionan servicios de pago ni realizan llamadas que generen facturación nueva sin confirmación previa del operador.
6. **Archivos Acotados**: Cada subagente puede modificar únicamente los archivos explícitamente asignados en su prompt.
7. **Sin Autoaprobación**: Un subagente nunca marca una tarea como "aprobada".

## Re-verificación Obligatoria por Cronos
Cronos nunca acepta el reporte o la afirmación de un subagente a ciegas:
- Cronos inspecciona los archivos y el diff resultante del subagente.
- Cronos reejecuta los comandos de prueba y verificación en su propio turno antes de aceptar el resultado.
