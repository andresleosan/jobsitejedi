# ADR-003: Región europea para el plano de datos Firebase

Fecha: `2026-08-29`

Estado: `aceptada`

## Contexto

El staging aislado usa Firestore Native en la multirregión `eur3`. Cloud Storage exige elegir una
ubicación permanente al crear el bucket y Cloud Functions usa una región estadounidense si el
código no define una explícitamente. Separar estos recursos aumenta la latencia y puede generar
cargos por transferencia entre ubicaciones.

## Decisión

Crear el bucket de staging en `europe-west1` y fijar todas las Cloud Functions de segunda
generación en `europe-west1`. Firestore permanece en `eur3`, igual que producción.

## Alternativas consideradas

- **`US-EAST1` sin costo inicial:** descartada porque separa Storage de Firestore y de los usuarios
  objetivo en Europa.
- **Storage multirregional `EU`:** descartada para este staging de bajo volumen porque añade costo
  de replicación y operaciones sin una necesidad actual de disponibilidad multirregional.
- **`europe-west2` (Londres):** mejora la cercanía al usuario final, pero separa Functions de la
  región recomendada por Firebase para Firestore `eur3`.
- **`europe-west1` (Bélgica):** aceptada porque Firebase la recomienda como región de Functions
  más cercana a `eur3` y permite ubicar Storage y Functions juntas.

## Consecuencias

- Storage y Functions comparten región y el backend queda cerca de Firestore `eur3`.
- La aplicación evita depender de la región predeterminada estadounidense de Functions.
- El bucket regional no tiene la redundancia geográfica de un bucket multirregional.
- Blaze sigue siendo pago por uso; el presupuesto de USD 5 solo genera alertas y no es un límite
  duro de consumo.
- Cambiar la ubicación del bucket requeriría crear y migrar a otro bucket.

## Confirmación del operador

El operador autorizó Blaze para staging con presupuesto de USD 5 el `2026-08-29`. El bucket se
creó privado por defecto en `europe-west1`; producción quedó fuera del alcance.
