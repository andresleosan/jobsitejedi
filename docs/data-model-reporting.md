# Contrato de lectura — detalle de proyecto y estados Firebase

Estado: cierre de runtime Supabase para T-012/T-019, sin migración de datos de producción.

## Fuentes

Las rutas `/project/{projectId}` y `/statements` usan exclusivamente colecciones Firebase ya
documentadas y protegidas:

| Colección | Uso de lectura | Identidad/autorización |
|---|---|---|
| `projects` | Nombre, cliente, dirección y estado de la obra. | Manager lee todo; builder solo proyectos propios. |
| `jobs` | Trabajos por proyecto y cierres incluidos en estados. | Manager lee todo; builder solo trabajos asignados. |
| `jobPhotos` + Storage `jobs/` | Evidencia y referencias privadas. | Manager o builder asignado. |
| `timeTracking` | Horas cerradas por builder/proyecto. | Manager lee todo; builder solo registros propios. |
| `invoices` | Gastos en GBP y snapshots de proyecto/usuario. | Manager lee todo; builder solo facturas propias. |
| `materialUsage` | Consumos con snapshots de material/proyecto/usuario. | Manager lee todo; builder solo consumos propios. |

No se añade una colección desnormalizada de reportes: el libro de estados deriva filas en memoria
desde fuentes canónicas. Los filtros de fecha, proyecto y builder no alteran datos. La exportación
es CSV UTF-8 generado en el navegador; las celdas que podrían interpretarse como fórmulas se
neutralizan antes de descargar.

## Límites y evolución

La primera versión carga las colecciones autorizadas y filtra localmente. Antes de que el volumen
medido lo justifique, no se agregan índices ni duplicados especulativos. T-016 deberá medir el
volumen y, si corresponde, introducir consultas paginadas por rango con sus índices documentados.

La carga masiva Excel heredada no se conecta a producción: dependía de una Function Supabase y de
`xlsx`, paquete sin corrección de seguridad. Se retira del runtime. Una futura importación deberá
ser una Cloud Function Firebase acotada, con parser mantenido, límites de filas/tamaño, validación
server-side e idempotencia.

## Rollback

El cambio no transforma ni borra datos remotos. Para revertir la aplicación:

1. Restaurar desde Git las pantallas anteriores y la dependencia de proveedor únicamente en una
   rama de diagnóstico; no desplegarlas mientras el proveedor esté retirado.
2. Mantener intactas las colecciones Firebase y el historial Supabase fuera del runtime.
3. Si se requiere importar datos históricos, preparar una migración separada con inventario,
   backup verificado, prueba de restauración y confirmación explícita del operador.

No se despliega, migra ni elimina información de producción en este bloque.
