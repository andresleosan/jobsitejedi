# ADR-001: Firebase como proveedor único objetivo

Fecha: `2026-08-24`

Estado: `aceptada`

## Contexto

La aplicación usa Firebase Auth en el frontend, pero mantiene consultas de datos y
Storage en Supabase. La sesión de Firebase no se traduce automáticamente en una sesión
RLS de Supabase. Además, las reglas Firestore/Storage actuales son un scaffold `deny all`
y las Cloud Functions todavía no implementan operaciones de negocio.

La mezcla actual bloquea el flujo de login, datos y archivos, y dificulta probar una única
frontera de autorización.

## Decisión

Completar la migración a Firebase y convertirlo en el único proveedor de runtime para
Auth, Firestore, Storage y Cloud Functions. Supabase quedará solo como historial y fuente
de referencia hasta que el operador autorice su retirada documental.

## Alternativas consideradas

- **Continuar con Supabase:** evita el trabajo de migración, pero exige revertir Firebase
  Auth, adaptar el backlog y corregir la auditoría sobre Storage en otro plan.
- **Mantener arquitectura híbrida:** se descarta porque conserva sesiones incompatibles,
  duplica reglas de autorización y aumenta el riesgo de accesos inconsistentes.
- **Firebase como proveedor único:** propuesta recomendada porque ya existe diseño,
  configuración local, emuladores y guard de migración; requiere completar el trabajo.

## Consecuencias

### Positivas

- Una sola sesión y una sola frontera de autorización.
- Reglas verificables en Emulator Suite.
- Repositorios tipados y Functions para operaciones privilegiadas.
- Menor superficie de dependencia en el frontend.

### Costos y riesgos

- Hay que implementar Firestore, Storage, Functions y pruebas antes de retirar Supabase.
- La instalación Firebase parte sin importar datos históricos.
- Producción puede requerir plan Blaze y control de costos.
- La decisión debe mantenerse bloqueada hasta completar pruebas de reglas y E2E.

## Confirmación del operador

El operador confirmó Firebase como proveedor único, la clasificación Nivel 3, la migración
incremental sin nueva ruta híbrida y la estrategia Emulator Suite + Vitest + Playwright
el `2026-08-24`.
